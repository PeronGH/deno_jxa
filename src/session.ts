class JXASession implements AsyncDisposable {
  #process: Deno.ChildProcess;

  constructor() {
    const command = new Deno.Command("/usr/bin/osascript", {
      args: ["-l", "JavaScript", "-i"],
      stdin: "piped",
      stdout: "null",
      stderr: "piped",
    });

    this.#process = command.spawn();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.#process[Symbol.asyncDispose]();
  }
}

export type { JXASession };

export const session = () => new JXASession();
