import {
  BufferOverflowError,
  MultiLineCodeError,
  NotSerializableError,
  ReplExecutionError,
  StreamEndedError,
} from "./error.ts";
import { RESULT_BUFFER_SIZE } from "./constants.ts";

const sessionSymbol = Symbol("session");
const varNameSymbol = Symbol("varName");
const thisContextSymbol = Symbol("thisContext");

type Handle = ((...args: unknown[]) => Handle) & {
  [sessionSymbol]: JXASession;
  [varNameSymbol]: string;
  [thisContextSymbol]?: string;
  [key: string]: Handle;
};

class JXASession implements Disposable {
  #worker: Worker;

  constructor() {
    this.#worker = new Worker(
      new URL("./session_worker.ts", import.meta.url).href,
      {
        type: "module",
      },
    );
  }

  #sendMessage(type: string, data: string): string {
    // SharedArrayBuffer layout: [0-3]: ready flag, [4-7]: status (1=success, 2=error), [8+]: result string
    const sab = new SharedArrayBuffer(8 + RESULT_BUFFER_SIZE);
    const int32 = new Int32Array(sab);
    Atomics.store(int32, 0, 0);

    this.#worker.postMessage({ type, data, sab });

    Atomics.wait(int32, 0, 0);

    const status = Atomics.load(int32, 1);

    const resultBuffer = new Uint8Array(sab, 8);
    const decoder = new TextDecoder();
    let resultLength = 0;
    while (
      resultLength < resultBuffer.length && resultBuffer[resultLength] !== 0
    ) {
      resultLength++;
    }
    const result = decoder.decode(resultBuffer.slice(0, resultLength));

    if (status === 2) {
      let errorData: { type: string; message: string };
      try {
        errorData = JSON.parse(result);
      } catch {
        throw new Error(result);
      }

      if (errorData.type === "MultiLineCodeError") {
        throw new MultiLineCodeError();
      } else if (errorData.type === "ReplExecutionError") {
        throw new ReplExecutionError(errorData.message);
      } else if (errorData.type === "BufferOverflowError") {
        throw new BufferOverflowError(errorData.message);
      } else {
        throw new Error(errorData.message);
      }
    }

    return result;
  }

  #createVar(expression: string): string {
    return this.#sendMessage("createVar", expression);
  }

  #handle(varName: string): Handle {
    const handle = (() => {}) as Handle;
    handle[sessionSymbol] = this;
    handle[varNameSymbol] = varName;

    const proxyHandler: ProxyHandler<Handle> = {
      get(target, prop) {
        if (typeof prop === "symbol") {
          return target[prop as keyof Handle];
        }

        const session = target[sessionSymbol];
        const currentVarName = target[varNameSymbol];

        const newVarName = session.#createVar(
          `Reflect.get(${currentVarName}, ${JSON.stringify(prop)})`,
        );

        const newHandle = (() => {}) as Handle;
        newHandle[sessionSymbol] = session;
        newHandle[varNameSymbol] = newVarName;
        newHandle[thisContextSymbol] = currentVarName;

        return new Proxy(newHandle, proxyHandler);
      },
      apply(target, _thisArg, args) {
        const session = target[sessionSymbol];
        const fnVarName = target[varNameSymbol];
        const thisContext = target[thisContextSymbol];

        const argStrings = args.map((arg) => {
          if (session.owns(arg)) {
            return (arg as Handle)[varNameSymbol];
          }
          return JSON.stringify(arg);
        });

        const thisArg = thisContext ?? "undefined";
        const callExpr = `Reflect.apply(${fnVarName}, ${thisArg}, [${
          argStrings.join(", ")
        }])`;
        const resultVarName = session.#createVar(callExpr);

        return session.#handle(resultVarName);
      },
      set(target, prop, value) {
        if (typeof prop === "symbol") {
          return false;
        }

        const session = target[sessionSymbol];
        const currentVarName = target[varNameSymbol];

        const valueHandle = session.wrap(value);
        const valueVarName = valueHandle[varNameSymbol];

        const result = session.unsafeExecute(
          `Reflect.set(${currentVarName}, ${
            JSON.stringify(prop)
          }, ${valueVarName})`,
        );

        return result === "true";
      },
    };

    return new Proxy(handle, proxyHandler);
  }

  owns(handle: Handle): boolean {
    return (typeof handle === "function") &&
      sessionSymbol in handle &&
      (handle as Handle)[sessionSymbol] === this;
  }

  wrap(value: unknown): Handle {
    let valueString: string;
    if (this.owns(value as Handle)) {
      return value as Handle;
    } else if (typeof value === "function") {
      valueString = `(${value.toString()})`;
    } else {
      valueString = JSON.stringify(value);
    }

    const varName = this.#createVar(valueString);
    return this.#handle(varName);
  }

  // deno-lint-ignore no-explicit-any
  unwrap(handle: Handle): any {
    if (!this.owns(handle)) {
      throw new TypeError("Handle does not belong to this session");
    }

    const varName = (handle as Handle)[varNameSymbol];

    const output = this.unsafeExecute(varName);

    try {
      return JSON.parse(output);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new NotSerializableError(
          `Value is not JSON serializable`,
          output,
        );
      }
      throw error;
    }
  }

  unsafeExecute(code: string): string {
    return this.#sendMessage("execute", code);
  }

  get globalThis(): Handle {
    return this.#handle("globalThis");
  }

  [Symbol.dispose](): void {
    this.#sendMessage("dispose", "");
    this.#worker.terminate();
  }
}

export type { JXASession };
export {
  BufferOverflowError,
  MultiLineCodeError,
  NotSerializableError,
  ReplExecutionError,
  StreamEndedError,
};

export const session = () => new JXASession();
