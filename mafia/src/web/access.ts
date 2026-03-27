import { JoinTicketService } from "./join-ticket";
import { PublicBaseUrlProvider } from "./public-base-url";

export class DashboardAccessService {
  constructor(
    private readonly publicBaseUrlProvider: PublicBaseUrlProvider,
    private readonly joinTicketService: JoinTicketService,
    private readonly joinTicketTtlMs: number,
  ) {}

  async issueJoinUrl(gameId: string, discordUserId: string): Promise<string> {
    const publicBaseUrl = await this.publicBaseUrlProvider.getPublicBaseUrl(gameId);
    const ticket = this.joinTicketService.issue({
      gameId,
      discordUserId,
      ttlMs: this.joinTicketTtlMs,
    });
    const url = new URL("/auth/exchange", ensureTrailingSlash(publicBaseUrl));
    url.searchParams.set("ticket", ticket);
    return url.toString();
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
