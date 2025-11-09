import { TextLineStream } from "@std/streams";
import {
  MultiLineCodeError,
  ReplExecutionError,
  StreamEndedError,
} from "./error.ts";

class JXASession implements AsyncDisposable {
  #process: Deno.ChildProcess;
  #writer: WritableStreamDefaultWriter<string>;
  #lineReader: ReadableStreamDefaultReader<string>;

  constructor() {
    // Use script to provide a PTY for proper line buffering
    const command = new Deno.Command("/usr/bin/script", {
      args: ["-q", "/dev/null", "/usr/bin/osascript", "-l", "JavaScript", "-i"],
      stdin: "piped",
      stdout: "piped", // REPL result
      stderr: "null", // Discard console.log output
    });

    this.#process = command.spawn();

    // Set up stdin with TextEncoderStream
    const { writable, readable } = new TextEncoderStream();
    readable.pipeTo(this.#process.stdin).catch(() => {
      // Ignore pipe errors on cleanup
    });
    this.#writer = writable.getWriter();

    // Set up stdout reader
    this.#lineReader = this.#process.stdout
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream())
      .getReader();
  }

  async execute(code: string): Promise<string> {
    const trimmedCode = code.trim();
    if (trimmedCode.includes("\n")) {
      throw new MultiLineCodeError();
    }

    await this.#writer.ready;
    await this.#writer.write(`${trimmedCode}\n\n`);

    let result: string | null = null;
    let isError = false;

    while (true) {
      const { value: line, done } = await this.#lineReader.read();
      if (done) throw new StreamEndedError();

      // Skip echo of the command and empty newline
      if (result === null && line.startsWith(">> ")) {
        continue;
      }

      // Skip console.log output and other non-result lines before we have a result
      if (
        result === null && !line.startsWith("=> ") && !line.startsWith("!! ")
      ) {
        continue;
      }

      // Parse result line
      if (line.startsWith("=> ")) {
        if (result === null) {
          // This is our result
          result = line.slice(3);
          isError = false;
          continue;
        } else {
          // This is the result of the empty command we sent, skip it
          continue;
        }
      }

      if (line.startsWith("!! ")) {
        if (result === null) {
          result = line.slice(3);
          isError = true;
          continue;
        } else {
          // Result of empty command, skip
          continue;
        }
      }

      // Prompt for the empty command means we're done
      if (line.startsWith(">> ") && result !== null) {
        if (isError) {
          throw new ReplExecutionError(result);
        }
        return result;
      }

      // Multi-line continuation
      if (result !== null) {
        result += `\n${line}`;
      }
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#lineReader.releaseLock();
    await this.#writer.close();
    await this.#process[Symbol.asyncDispose]();
  }
}

export type { JXASession };
export { MultiLineCodeError, ReplExecutionError, StreamEndedError };

export const session = () => new JXASession();
