/** What a device is shown, and what the app needs to open the right screen when it is tapped. */
export interface PushMessage {
  title: string;
  body: string;
  /** Strings only: push providers carry no other type. */
  data: Record<string, string>;
}

/** What happened to each token handed to [PushSender.send]. */
export interface PushResult {
  /** Tokens the provider says are gone for good (app uninstalled, token rotated); they are switched off. */
  invalidTokens: string[];
}

/** A push provider. FCM today; kept behind this so a transport can change without touching delivery. */
export interface PushSender {
  readonly enabled: boolean;
  send(tokens: readonly string[], message: PushMessage): Promise<PushResult>;
}

/** Used when no provider credentials are configured: delivery stays in-app and nothing is attempted. */
export class NoopPushSender implements PushSender {
  readonly enabled = false;

  async send(): Promise<PushResult> {
    return { invalidTokens: [] };
  }
}
