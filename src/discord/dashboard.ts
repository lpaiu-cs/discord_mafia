import { ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionReplyOptions } from "discord.js";

export function buildDashboardReply(gameId: string, joinUrl: string, ttlSeconds: number): InteractionReplyOptions {
  return {
    content: `개인 입장 링크를 발급했습니다. 이 링크는 약 ${Math.floor(ttlSeconds / 60)}분 안에 1회만 사용할 수 있습니다.`,
    ephemeral: true,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setLabel("웹 대시보드 열기").setStyle(ButtonStyle.Link).setURL(joinUrl),
        new ButtonBuilder().setCustomId(`dashboard:${gameId}:refresh`).setLabel("새 링크 발급").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}
