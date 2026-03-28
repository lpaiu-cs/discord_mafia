import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { PassThrough } from "node:stream";
import { resolve } from "node:path";
import {
  AudioPlayer,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import { Client, Guild } from "discord.js";
import { LiarGame } from "../engine/game";

const ffmpegPath = require("ffmpeg-static") as string | null;

const PCM_SAMPLE_RATE = 48_000;
const PCM_CHANNELS = 2;
const PCM_BYTES_PER_SAMPLE = 2;
const PCM_FRAME_MS = 20;
const PCM_CHUNK_SIZE = (PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE * PCM_FRAME_MS) / 1_000;

type LoopTrackKey = "lobby" | "discussion" | "guess";
type OverlayTrackKey = "join" | "start" | "turn";
type ResultTrackKey = "citizensWin" | "liarWin";
type TrackKey = LoopTrackKey | OverlayTrackKey | ResultTrackKey;

interface PcmSource {
  readonly key: TrackKey;
  readonly process: ReturnType<typeof spawn>;
  readonly buffers: Buffer[];
  bufferedBytes: number;
  ended: boolean;
}

interface AudioMixer {
  readonly output: PassThrough;
  bgmKey: LoopTrackKey | null;
  bgmSource: PcmSource | null;
  readonly overlays: PcmSource[];
  readonly timer: NodeJS.Timeout;
}

interface BroadcastSession {
  readonly guildId: string;
  readonly player: AudioPlayer;
  connection: VoiceConnection;
  channelId: string;
  mixer: AudioMixer | null;
  resultSource: PcmSource | null;
  destroyAfterResult: boolean;
  pendingReadyReplay: NodeJS.Timeout | null;
}

export interface LiarAudioContext {
  readonly guild?: Guild | null;
  readonly hostVoiceChannelId?: string | null;
}

export interface LiarAudioController {
  syncPhase(client: Client, game: LiarGame, context?: LiarAudioContext): Promise<void>;
  playLobbyJoin(client: Client, game: LiarGame, context?: LiarAudioContext): Promise<void>;
  playGameStart(client: Client, game: LiarGame, context?: LiarAudioContext): Promise<void>;
  playTurnCue(client: Client, game: LiarGame, context?: LiarAudioContext): Promise<void>;
  destroy(guildId: string): Promise<void>;
}

const TRACK_FILES: Record<TrackKey, string> = {
  lobby: "bgm_lobby.mp3",
  discussion: "bgm_discussion.mp3",
  guess: "bgm_guess.mp3",
  join: "sfx_join.mp3",
  start: "sfx_start.mp3",
  turn: "sfx_turn.mp3",
  citizensWin: "bgm_citizen_win.mp3",
  liarWin: "bgm_liar_win.mp3",
};

const AUDIO_ROOT_CANDIDATES = [
  resolve(__dirname, "../../resource/audio"),
  resolve(__dirname, "../../../../liar/resource/audio"),
];

function resolveAudioPath(filename: string): string {
  for (const root of AUDIO_ROOT_CANDIDATES) {
    const candidate = resolve(root, filename);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`라이어 오디오 파일을 찾을 수 없습니다: ${filename}`);
}

function phaseLoopTrack(game: LiarGame): LoopTrackKey | null {
  switch (game.phase) {
    case "lobby":
      return "lobby";
    case "clue":
    case "discussion":
    case "voting":
      return "discussion";
    case "guess":
      return "guess";
    default:
      return null;
  }
}

function resultTrack(game: LiarGame): ResultTrackKey | null {
  if (!game.result) {
    return null;
  }

  switch (game.result.winner) {
    case "citizens":
      return "citizensWin";
    case "liar":
      return "liarWin";
    default:
      return null;
  }
}

export class NoopLiarAudioController implements LiarAudioController {
  async syncPhase(): Promise<void> {}
  async playLobbyJoin(): Promise<void> {}
  async playGameStart(): Promise<void> {}
  async playTurnCue(): Promise<void> {}
  async destroy(): Promise<void> {}
}

export class DiscordVoiceLiarAudioController implements LiarAudioController {
  private readonly sessions = new Map<string, BroadcastSession>();

  async syncPhase(client: Client, game: LiarGame, context: LiarAudioContext = {}): Promise<void> {
    const playback = await this.resolvePlaybackContext(client, game, context);
    const winnerTrack = game.phase === "ended" ? resultTrack(game) : null;
    const loopTrackKey = phaseLoopTrack(game);

    if (!playback) {
      await this.destroy(game.guildId);
      return;
    }

    const session = await this.ensureSession(playback.guild, playback.channelId);

    if (winnerTrack) {
      this.stopMixer(session);
      session.destroyAfterResult = true;
      this.playResultTrack(session, winnerTrack);
      if (session.connection.state.status !== VoiceConnectionStatus.Ready) {
        this.scheduleReadyReplay(session);
      }
      return;
    }

    session.destroyAfterResult = false;
    this.startMixer(session, loopTrackKey);
    if (session.connection.state.status !== VoiceConnectionStatus.Ready) {
      this.scheduleReadyReplay(session);
    }
  }

  async playLobbyJoin(client: Client, game: LiarGame, context: LiarAudioContext = {}): Promise<void> {
    if (game.phase !== "lobby") {
      return;
    }

    const playback = await this.resolvePlaybackContext(client, game, context);
    if (!playback) {
      return;
    }

    const session = await this.ensureSession(playback.guild, playback.channelId);
    this.startMixer(session, "lobby");
    this.enqueueOverlay(session, "join");
  }

  async playGameStart(client: Client, game: LiarGame, context: LiarAudioContext = {}): Promise<void> {
    const playback = await this.resolvePlaybackContext(client, game, context);
    if (!playback) {
      return;
    }

    const session = await this.ensureSession(playback.guild, playback.channelId);
    this.startMixer(session, phaseLoopTrack(game));
    this.enqueueOverlay(session, "start");
  }

  async playTurnCue(client: Client, game: LiarGame, context: LiarAudioContext = {}): Promise<void> {
    const playback = await this.resolvePlaybackContext(client, game, context);
    if (!playback) {
      return;
    }

    const session = await this.ensureSession(playback.guild, playback.channelId);
    this.startMixer(session, phaseLoopTrack(game));
    this.enqueueOverlay(session, "turn");
  }

  async destroy(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session) {
      return;
    }

    if (session.pendingReadyReplay) {
      clearTimeout(session.pendingReadyReplay);
      session.pendingReadyReplay = null;
    }
    this.stopMixer(session);
    this.stopSource(session.resultSource);
    session.resultSource = null;
    session.player.stop(true);
    session.connection.destroy();
    this.sessions.delete(guildId);
  }

  private async resolvePlaybackContext(
    client: Client,
    game: LiarGame,
    context: LiarAudioContext,
  ): Promise<{ guild: Guild; channelId: string } | null> {
    const guild = context.guild ?? (await this.resolveGuild(client, game.channelId));
    if (!guild) {
      return null;
    }

    const channelId = context.hostVoiceChannelId ?? (await this.resolveHostVoiceChannelId(guild, game.hostId));
    if (!channelId) {
      return null;
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isVoiceBased()) {
      return null;
    }

    return { guild, channelId };
  }

  private async resolveGuild(client: Client, textChannelId: string): Promise<Guild | null> {
    const channel = await client.channels.fetch(textChannelId);
    if (!channel || !("guild" in channel)) {
      return null;
    }

    return channel.guild ?? null;
  }

  private async resolveHostVoiceChannelId(guild: Guild, hostId: string): Promise<string | null> {
    const member = await guild.members.fetch(hostId);
    return member.voice.channelId ?? null;
  }

  private async ensureSession(guild: Guild, channelId: string): Promise<BroadcastSession> {
    const existing = this.sessions.get(guild.id);
    if (existing && existing.channelId === channelId && existing.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      return existing;
    }

    if (existing) {
      await this.destroy(guild.id);
    }

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });
    const connection = joinVoiceChannel({
      guildId: guild.id,
      channelId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    const session: BroadcastSession = {
      guildId: guild.id,
      player,
      connection,
      channelId,
      mixer: null,
      resultSource: null,
      destroyAfterResult: false,
      pendingReadyReplay: null,
    };

    connection.subscribe(player);
    connection.on("stateChange", (_oldState, newState) => {
      this.debug(session.guildId, `voice ${_oldState.status} -> ${newState.status}`);
      if (newState.status === VoiceConnectionStatus.Ready) {
        this.scheduleReadyReplay(session);
      }
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        console.warn(`liar voice connection disconnected in guild ${guild.id}`);
      }
    });

    player.on(AudioPlayerStatus.Idle, () => {
      this.debug(session.guildId, "player idle");
      if (session.resultSource && session.destroyAfterResult) {
        void this.destroy(session.guildId);
      }
    });
    player.on("stateChange", (oldState, newState) => {
      this.debug(session.guildId, `player ${oldState.status} -> ${newState.status}`);
    });
    player.on("error", (error: Error) => {
      console.error(`failed to play liar audio in guild ${guild.id}`, error);
      if (session.resultSource) {
        this.stopSource(session.resultSource);
        session.resultSource = null;
      }
    });
    connection.on("error", (error: Error) => {
      console.error(`liar voice connection error in guild ${guild.id}`, error);
    });

    this.sessions.set(guild.id, session);
    this.bootstrapReadyReplay(session);
    return session;
  }

  private startMixer(session: BroadcastSession, bgmKey: LoopTrackKey | null): void {
    if (!session.mixer) {
      this.debug(session.guildId, `start mixer bgm=${bgmKey ?? "none"} status=${session.connection.state.status}`);
      const output = new PassThrough();
      const resource = createAudioResource(output, {
        inputType: StreamType.Raw,
      });
      const mixer: AudioMixer = {
        output,
        bgmKey,
        bgmSource: bgmKey ? this.createPcmSource(bgmKey) : null,
        overlays: [],
        timer: setInterval(() => {
          this.pumpMixer(session);
        }, PCM_FRAME_MS),
      };
      mixer.timer.unref?.();
      session.mixer = mixer;
      session.resultSource = null;
      session.player.play(resource);
      return;
    }

    if (session.mixer.bgmKey === bgmKey) {
      return;
    }

    this.debug(session.guildId, `swap mixer bgm=${session.mixer.bgmKey ?? "none"} -> ${bgmKey ?? "none"}`);
    session.mixer.bgmKey = bgmKey;
    this.stopSource(session.mixer.bgmSource);
    session.mixer.bgmSource = bgmKey ? this.createPcmSource(bgmKey) : null;
  }

  private scheduleReadyReplay(session: BroadcastSession): void {
    this.debug(session.guildId, `schedule ready replay status=${session.connection.state.status}`);
    if (session.pendingReadyReplay) {
      clearTimeout(session.pendingReadyReplay);
    }

    session.pendingReadyReplay = setTimeout(() => {
      session.pendingReadyReplay = null;
      void this.replayCurrentAudio(session.guildId);
    }, 150);
    session.pendingReadyReplay.unref?.();
  }

  private bootstrapReadyReplay(session: BroadcastSession): void {
    this.debug(session.guildId, "bootstrap ready replay");
    void entersState(session.connection, VoiceConnectionStatus.Ready, 20_000)
      .then(() => {
        if (this.sessions.get(session.guildId) !== session) {
          return;
        }
        this.scheduleReadyReplay(session);
      })
      .catch(() => undefined);
  }

  private async replayCurrentAudio(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session) {
      return;
    }

    this.debug(guildId, `replay current audio status=${session.connection.state.status}`);

    try {
      await entersState(session.connection, VoiceConnectionStatus.Ready, 2_000);
    } catch {
      this.debug(guildId, "replay skipped because connection was not ready in time");
      return;
    }

    if (session.resultSource) {
      const resultKey = session.resultSource.key as ResultTrackKey;
      this.stopSource(session.resultSource);
      session.resultSource = null;
      this.playResultTrack(session, resultKey);
      return;
    }

    if (!session.mixer) {
      return;
    }

    const bgmKey = session.mixer.bgmKey;
    const overlayKeys = session.mixer.overlays.map((overlay) => overlay.key as OverlayTrackKey);
    this.debug(guildId, `replay mixer bgm=${bgmKey ?? "none"} overlays=${overlayKeys.join(",") || "none"}`);
    this.stopMixer(session);
    this.startMixer(session, bgmKey);
    for (const overlayKey of overlayKeys) {
      this.enqueueOverlay(session, overlayKey);
    }
  }

  private stopMixer(session: BroadcastSession): void {
    const mixer = session.mixer;
    if (!mixer) {
      return;
    }

    clearInterval(mixer.timer);
    this.stopSource(mixer.bgmSource);
    for (const overlay of mixer.overlays) {
      this.stopSource(overlay);
    }
    mixer.overlays.length = 0;
    mixer.output.end();
    session.mixer = null;
  }

  private playResultTrack(session: BroadcastSession, key: ResultTrackKey): void {
    this.debug(session.guildId, `play result track=${key}`);
    this.stopSource(session.resultSource);
    const source = this.createPcmSource(key);
    session.resultSource = source;
    if (!source.process.stdout) {
      throw new Error("라이어 결과 오디오 stdout 을 열지 못했습니다.");
    }

    const resource = createAudioResource(source.process.stdout, {
      inputType: StreamType.Raw,
    });
    session.player.play(resource);
  }

  private enqueueOverlay(session: BroadcastSession, key: OverlayTrackKey): void {
    if (!session.mixer) {
      return;
    }

    this.debug(session.guildId, `enqueue overlay=${key}`);
    session.mixer.overlays.push(this.createPcmSource(key));
  }

  private pumpMixer(session: BroadcastSession): void {
    const mixer = session.mixer;
    if (!mixer) {
      return;
    }

    if (mixer.bgmKey && (!mixer.bgmSource || (mixer.bgmSource.ended && mixer.bgmSource.bufferedBytes === 0))) {
      this.stopSource(mixer.bgmSource);
      mixer.bgmSource = this.createPcmSource(mixer.bgmKey);
    }

    const mixedChunk = Buffer.alloc(PCM_CHUNK_SIZE);
    if (mixer.bgmSource) {
      const bgmChunk = this.consumeChunk(mixer.bgmSource, PCM_CHUNK_SIZE);
      bgmChunk.copy(mixedChunk, 0, 0, PCM_CHUNK_SIZE);
    }

    for (let index = mixer.overlays.length - 1; index >= 0; index -= 1) {
      const overlay = mixer.overlays[index];
      const overlayChunk = this.consumeChunk(overlay, PCM_CHUNK_SIZE);
      this.mixPcmInto(mixedChunk, overlayChunk);

      if (overlay.ended && overlay.bufferedBytes === 0) {
        this.stopSource(overlay);
        mixer.overlays.splice(index, 1);
      }
    }

    mixer.output.write(mixedChunk);
  }

  private mixPcmInto(target: Buffer, overlay: Buffer): void {
    for (let offset = 0; offset < target.length; offset += PCM_BYTES_PER_SAMPLE) {
      const mixed = target.readInt16LE(offset) + overlay.readInt16LE(offset);
      const clamped = Math.max(-32768, Math.min(32767, mixed));
      target.writeInt16LE(clamped, offset);
    }
  }

  private consumeChunk(source: PcmSource, size: number): Buffer {
    const chunk = Buffer.alloc(size);
    let written = 0;

    while (written < size && source.buffers.length > 0) {
      const current = source.buffers[0];
      const remaining = size - written;
      const take = Math.min(current.length, remaining);
      current.copy(chunk, written, 0, take);
      written += take;
      source.bufferedBytes -= take;

      if (take === current.length) {
        source.buffers.shift();
      } else {
        source.buffers[0] = current.subarray(take);
      }
    }

    return chunk;
  }

  private createPcmSource(key: TrackKey): PcmSource {
    const executable = ffmpegPath ?? "ffmpeg";
    const filePath = resolveAudioPath(TRACK_FILES[key]);
    this.debug("global", `spawn ffmpeg track=${key} file=${filePath}`);
    const process = spawn(
      executable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        filePath,
        "-f",
        "s16le",
        "-ar",
        String(PCM_SAMPLE_RATE),
        "-ac",
        String(PCM_CHANNELS),
        "pipe:1",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    if (!process.stdout) {
      throw new Error("라이어 오디오 ffmpeg stdout 파이프를 열지 못했습니다.");
    }

    const source: PcmSource = {
      key,
      process,
      buffers: [],
      bufferedBytes: 0,
      ended: false,
    };

    process.stdout.on("data", (chunk: Buffer) => {
      source.buffers.push(chunk);
      source.bufferedBytes += chunk.length;
    });
    process.stdout.on("end", () => {
      source.ended = true;
    });
    process.on("error", (error: Error) => {
      source.ended = true;
      console.error(`failed to decode liar audio track ${key}`, error);
    });

    return source;
  }

  private stopSource(source: PcmSource | null): void {
    if (!source || source.process.killed) {
      return;
    }

    source.process.kill("SIGKILL");
  }

  private debug(guildId: string, message: string): void {
    if (process.env.LIAR_AUDIO_DEBUG !== "true") {
      return;
    }

    console.error(`[liar-audio:${guildId}] ${message}`);
  }
}
