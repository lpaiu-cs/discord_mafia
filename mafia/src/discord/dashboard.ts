import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors, EmbedBuilder, InteractionReplyOptions } from "discord.js";

export function buildDashboardWaitingReply(
  gameId: string,
  options?: {
    started?: boolean;
    note?: string;
  },
): InteractionReplyOptions {
  const started = options?.started ?? false;
  const note = options?.note;
  const descriptionLines = started
    ? [
        "게임이 시작되었습니다.",
        "아래 버튼을 눌러 웹 대시보드 입장 링크를 불러오세요.",
      ]
    : [
        "참가 등록이 완료되었습니다.",
        "게임이 시작되면 아래 버튼으로 웹 대시보드 입장 링크를 받을 수 있습니다.",
      ];

  if (note) {
    descriptionLines.push(note);
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(started ? Colors.Orange : Colors.Blurple)
        .setTitle(started ? "웹 대시보드 준비 완료" : "웹 대시보드 대기 중")
        .setDescription(descriptionLines.join("\n")),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`dashboard:${gameId}:open`).setLabel("대시보드 열기").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`dashboard:${gameId}:refresh`).setLabel("상태 새로고침").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildDashboardReply(gameId: string, joinUrl: string, ttlSeconds: number): InteractionReplyOptions {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle("웹 대시보드 입장 링크")
        .setDescription(`개인 입장 링크를 발급했습니다. 이 링크는 약 ${Math.floor(ttlSeconds / 60)}분 안에 1회만 사용할 수 있습니다.`),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setLabel("웹 대시보드 열기").setStyle(ButtonStyle.Link).setURL(joinUrl),
        new ButtonBuilder().setCustomId(`dashboard:${gameId}:refresh`).setLabel("새 링크 발급").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}
