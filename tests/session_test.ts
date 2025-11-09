import {
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
} from "@std/assert";
import {
  MultiLineCodeError,
  ReplExecutionError,
  session,
} from "../src/session.ts";

Deno.test("JXASession - basic arithmetic", async () => {
  await using s = session();
  const result = await s.execute("1 + 1");
  assertEquals(result, "2");
});

Deno.test("JXASession - console.log is discarded", async () => {
  await using s = session();
  const result = await s.execute("console.log('hi')");
  assertEquals(result, "undefined");
});

Deno.test("JXASession - multi-line result", async () => {
  await using s = session();
  const result = await s.execute("Error");
  assertStringIncludes(result, "[function Error]");
});

Deno.test("JXASession - rejects multi-line code", async () => {
  await using s = session();
  try {
    await s.execute("1 + 1\n2 + 2");
    throw new Error("Should have thrown");
  } catch (err) {
    assertInstanceOf(err, MultiLineCodeError);
  }
});

Deno.test("JXASession - multiple sequential executions", async () => {
  await using s = session();

  const result1 = await s.execute("1");
  assertEquals(result1, "1");

  const result2 = await s.execute("2");
  assertEquals(result2, "2");

  const result3 = await s.execute("3");
  assertEquals(result3, "3");
});

Deno.test("JXASession - throws ReplExecutionError on REPL error", async () => {
  await using s = session();
  try {
    await s.execute("throw new Error('test error')");
    throw new Error("Should have thrown");
  } catch (err) {
    assertInstanceOf(err, ReplExecutionError);
    assertStringIncludes((err as Error).message, "REPL execution error");
  }
});
