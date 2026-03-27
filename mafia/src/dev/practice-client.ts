import { ChannelType, Client } from "discord.js";

class PracticeMessage {
  constructor(
    public readonly id: string,
    public payload: unknown,
  ) {}

  async edit(payload: unknown): Promise<PracticeMessage> {
    this.payload = payload;
    return this;
  }
}

class PracticeTextChannel {
  public readonly type = ChannelType.GuildText;
  private readonly storedMessages = new Map<string, PracticeMessage>();

  public readonly messages = {
    fetch: async (messageId: string) => this.storedMessages.get(messageId) ?? null,
  };

  async send(payload: unknown): Promise<PracticeMessage> {
    const message = new PracticeMessage(makeId(), payload);
    this.storedMessages.set(message.id, message);
    return message;
  }
}

export function createPracticeClient(): Client {
  const channels = new Map<string, PracticeTextChannel>();

  return {
    channels: {
      fetch: async (channelId: string) => {
        let channel = channels.get(channelId);
        if (!channel) {
          channel = new PracticeTextChannel();
          channels.set(channelId, channel);
        }
        return channel as never;
      },
    },
  } as never as Client;
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)
    .toString()
    .padStart(4, "0")}`;
}
