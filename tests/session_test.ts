import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
} from "@std/assert";
import {
  BufferOverflowError,
  MultiLineCodeError,
  NotSerializableError,
  ReplExecutionError,
  session,
} from "../src/session.ts";

Deno.test("JXASession - basic execution", async (t) => {
  await t.step("basic arithmetic", () => {
    using s = session();
    const result = s.unsafeExecute("1 + 1");
    assertEquals(result, "2");
  });

  await t.step("console.log is discarded", () => {
    using s = session();
    const result = s.unsafeExecute("console.log('hi')");
    assertEquals(result, "undefined");
  });

  await t.step("multi-line result", () => {
    using s = session();
    const result = s.unsafeExecute("Error");
    assertStringIncludes(result, "[function Error]");
  });

  await t.step("multiple sequential executions", () => {
    using s = session();

    const result1 = s.unsafeExecute("1");
    assertEquals(result1, "1");

    const result2 = s.unsafeExecute("2");
    assertEquals(result2, "2");

    const result3 = s.unsafeExecute("3");
    assertEquals(result3, "3");
  });
});

Deno.test("JXASession - error handling", async (t) => {
  await t.step("rejects multi-line code", () => {
    using s = session();
    try {
      s.unsafeExecute("1 + 1\n2 + 2");
      throw new Error("Should have thrown");
    } catch (err) {
      assertInstanceOf(err, MultiLineCodeError);
    }
  });

  await t.step("throws ReplExecutionError on REPL error", () => {
    using s = session();
    try {
      s.unsafeExecute("throw new Error('test error')");
      throw new Error("Should have thrown");
    } catch (err) {
      assertInstanceOf(err, ReplExecutionError);
      assertStringIncludes((err as Error).message, "REPL execution error");
    }
  });

  await t.step("throws BufferOverflowError on large result", () => {
    using s = session();
    try {
      // Create a large string that exceeds 16KB
      s.unsafeExecute("'x'.repeat(20000)");
      throw new Error("Should have thrown");
    } catch (err) {
      assertInstanceOf(err, BufferOverflowError);
      assertStringIncludes((err as Error).message, "exceeds buffer size");
    }
  });
});

Deno.test("JXASession - owns method", async (t) => {
  await t.step("recognizes own handles", () => {
    using s = session();
    const handle = s.globalThis;
    assertEquals(s.owns(handle), true);
  });

  await t.step("rejects handles from different session", () => {
    using s1 = session();
    using s2 = session();
    const handle = s1.globalThis;
    assertEquals(s2.owns(handle), false);
  });
});

Deno.test("JXASession - unwrap method", async (t) => {
  await t.step("unwraps JSON-serializable number", () => {
    using s = session();
    s.unsafeExecute("globalThis.testNum = 42");
    const handle = s.globalThis.testNum;
    const result = s.unwrap(handle);
    assertEquals(result, 42);
  });

  await t.step("unwraps JSON-serializable string", () => {
    using s = session();
    s.unsafeExecute("globalThis.testStr = 'hello'");
    const handle = s.globalThis.testStr;
    const result = s.unwrap(handle);
    assertEquals(result, "hello");
  });

  await t.step("unwraps JSON-serializable object", () => {
    using s = session();
    s.unsafeExecute("globalThis.testObj = {foo: 'bar', num: 123}");
    const handle = s.globalThis.testObj;
    const result = s.unwrap(handle);
    assertEquals(result, { foo: "bar", num: 123 });
  });

  await t.step("unwraps JSON-serializable array", () => {
    using s = session();
    s.unsafeExecute("globalThis.testArr = [1, 2, 3]");
    const handle = s.globalThis.testArr;
    const result = s.unwrap(handle);
    assertEquals(result, [1, 2, 3]);
  });

  await t.step("throws NotSerializableError for function", () => {
    using s = session();
    const handle = s.globalThis.Error;
    try {
      s.unwrap(handle);
      throw new Error("Should have thrown");
    } catch (err) {
      assertInstanceOf(err, NotSerializableError);
      assertStringIncludes(
        (err as NotSerializableError).originalOutput,
        "Error",
      );
    }
  });

  await t.step("throws TypeError for handle from different session", () => {
    using s1 = session();
    using s2 = session();
    const handle = s1.globalThis;
    try {
      s2.unwrap(handle);
      throw new Error("Should have thrown");
    } catch (err) {
      assertInstanceOf(err, TypeError);
      assertStringIncludes(
        (err as Error).message,
        "does not belong to this session",
      );
    }
  });
});

Deno.test("JXASession - function calls", async (t) => {
  await t.step("call function with primitive arguments", () => {
    using s = session();
    const result = s.globalThis.Math.max(1, 5, 3);
    assertEquals(s.unwrap(result), 5);
  });

  await t.step("array method with handle callback", () => {
    using s = session();
    s.globalThis.nums = s.wrap([1, 2, 3, 4, 5]);
    s.globalThis.isEven = s.wrap((x: number) => x % 2 === 0);
    const nums = s.globalThis.nums;
    const isEven = s.globalThis.isEven;
    const result = nums.filter(isEven);
    assertEquals(s.unwrap(result), [2, 4]);
  });

  await t.step("objective-c interop", () => {
    using s = session();
    const pid = s.globalThis.$.NSProcessInfo.processInfo.processIdentifier;
    const pidValue = s.unwrap(pid);
    assert(typeof pidValue === "number");
    assert(pidValue > 0);
  });
});
