import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { config } from "../config";

export const mafiaCommand = new SlashCommandBuilder()
  .setName("mafia")
  .setDescription("마피아42 시즌4 게임을 관리합니다.")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create")
      .setDescription("현재 채널에 새 게임 로비를 만듭니다.")
      .addStringOption((option) =>
        option
          .setName("ruleset")
          .setDescription("시즌4 세부 규칙셋")
          .addChoices(
            { name: "시즌4 밸런스", value: "balance" },
            { name: "시즌4 초기", value: "initial" },
          ),
      ),
  )
  .addSubcommand((subcommand) => subcommand.setName("join").setDescription("현재 로비에 참가합니다."))
  .addSubcommand((subcommand) => subcommand.setName("leave").setDescription("현재 로비에서 나갑니다."))
  .addSubcommand((subcommand) => subcommand.setName("start").setDescription("현재 로비를 시작합니다."))
  .addSubcommand((subcommand) => subcommand.setName("status").setDescription("현재 게임 상태를 다시 표시합니다."))
  .addSubcommand((subcommand) => subcommand.setName("reveal").setDescription("현재 역할 배정을 방장에게만 표시합니다."))
  .addSubcommand((subcommand) => subcommand.setName("advance").setDescription("현재 단계를 강제로 넘깁니다."))
  .addSubcommand((subcommand) => subcommand.setName("end").setDescription("현재 게임을 종료합니다."));

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.token);
  const body = [mafiaCommand.toJSON()];

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.applicationId, config.guildId), { body });
    return;
  }

  await rest.put(Routes.applicationCommands(config.applicationId), { body });
}
