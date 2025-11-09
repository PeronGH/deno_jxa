export class JXAError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JXAError";
  }
}

export class MultiLineCodeError extends JXAError {
  constructor() {
    super("Multi-line code is not supported");
    this.name = "MultiLineCodeError";
  }
}

export class StreamEndedError extends JXAError {
  constructor() {
    super("Stream ended unexpectedly");
    this.name = "StreamEndedError";
  }
}

export class ReplExecutionError extends JXAError {
  constructor(
    public readonly error: string,
  ) {
    super(`REPL execution error: ${error}`);
    this.name = "ReplExecutionError";
  }
}

export class BufferOverflowError extends JXAError {
  constructor(message: string) {
    super(message);
    this.name = "BufferOverflowError";
  }
}

export class NotSerializableError extends JXAError {
  constructor(
    message: string,
    public readonly originalOutput: string,
  ) {
    super(message);
    this.name = "NotSerializableError";
  }
}
