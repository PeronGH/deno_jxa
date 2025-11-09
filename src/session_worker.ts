/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { TextLineStream } from "@std/streams";
import {
  BufferOverflowError,
  MultiLineCodeError,
  ReplExecutionError,
  StreamEndedError,
} from "./error.ts";
import { RESULT_BUFFER_SIZE } from "./constants.ts";

class JXASessionWorker {
  #process: Deno.ChildProcess;
  #writer: WritableStreamDefaultWriter<string>;
  #lineReader: ReadableStreamDefaultReader<string>;
  #varCounter = 0;

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

  async createVar(expression: string): Promise<string> {
    const varName = `$${this.#varCounter++}`;
    await this.execute(`const ${varName} = ${expression}`);
    return varName;
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

  async dispose(): Promise<void> {
    this.#lineReader.releaseLock();
    await this.#writer.close();
    await this.#process[Symbol.asyncDispose]();
  }
}

// Worker message handling
const session = new JXASessionWorker();

self.onmessage = async (e: MessageEvent) => {
  const { type, data, sab } = e.data;
  const int32 = new Int32Array(sab);
  const resultBuffer = new Uint8Array(sab, 8); // Skip first 8 bytes for control

  try {
    let result: string;

    if (type === "execute") {
      result = await session.execute(data);
    } else if (type === "createVar") {
      result = await session.createVar(data);
    } else if (type === "dispose") {
      await session.dispose();
      result = "disposed";
    } else {
      throw new Error(`Unknown message type: ${type}`);
    }

    // Write result to shared buffer
    const encoder = new TextEncoder();
    const encoded = encoder.encode(result);

    // Check if message exceeds buffer size
    if (encoded.length >= RESULT_BUFFER_SIZE) {
      throw new BufferOverflowError(
        `Message length (${encoded.length} bytes) exceeds buffer size (${RESULT_BUFFER_SIZE} bytes)`,
      );
    }

    resultBuffer.set(encoded);
    resultBuffer[encoded.length] = 0; // Null terminator

    // Mark as success (status = 1)
    Atomics.store(int32, 1, 1);
  } catch (error) {
    // Serialize error with type information
    let errorType = "Error";
    let errorMsg = String(error);

    if (error instanceof MultiLineCodeError) {
      errorType = "MultiLineCodeError";
      errorMsg = error.message;
    } else if (error instanceof ReplExecutionError) {
      errorType = "ReplExecutionError";
      errorMsg = error.message;
    } else if (error instanceof BufferOverflowError) {
      errorType = "BufferOverflowError";
      errorMsg = error.message;
    } else if (error instanceof Error) {
      errorMsg = error.message;
    }

    const errorJson = JSON.stringify({ type: errorType, message: errorMsg });
    const encoder = new TextEncoder();
    const encoded = encoder.encode(errorJson);

    // Check if error message exceeds buffer size
    if (encoded.length >= RESULT_BUFFER_SIZE) {
      // If even the error message is too large, send a truncated error message
      const truncatedError = JSON.stringify({
        type: "BufferOverflowError",
        message:
          `Error message length (${encoded.length} bytes) exceeds buffer size (${RESULT_BUFFER_SIZE} bytes)`,
      });
      const truncatedEncoded = encoder.encode(truncatedError);
      resultBuffer.set(truncatedEncoded);
      resultBuffer[truncatedEncoded.length] = 0;
    } else {
      resultBuffer.set(encoded);
      resultBuffer[encoded.length] = 0;
    }

    // Mark as error (status = 2)
    Atomics.store(int32, 1, 2);
  } finally {
    // Signal completion
    Atomics.store(int32, 0, 1);
    Atomics.notify(int32, 0);
  }
};
