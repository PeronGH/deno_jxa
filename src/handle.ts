import { JXASession } from "./session.ts";

export class JXAHandle {
  #session: JXASession;
  #varName: string;

  constructor(session: JXASession, varName: string) {
    this.#session = session;
    this.#varName = varName;

    // biome-ignore lint/correctness/noConstructorReturn: expected behaviour
    return new Proxy(this, {
      get() {},
    });
  }
}
