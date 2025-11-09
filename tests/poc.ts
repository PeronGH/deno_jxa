import { assertEquals } from "@std/assert";
import { TextLineStream } from "@std/streams";

// Create process - use script to provide a PTY for proper line buffering
const command = new Deno.Command("/usr/bin/script", {
  args: ["-q", "/dev/null", "/usr/bin/osascript", "-l", "JavaScript", "-i"],
  stdin: "piped",
  stdout: "piped", // REPL result
  stderr: "null", // Discard console.log output
});

await using process = command.spawn();

// Handle stdin
const { writable, readable } = new TextEncoderStream();
readable.pipeTo(process.stdin).catch(() =>
  console.debug("encoder stream error")
);
const writer = writable.getWriter();

// Handle stdout
type ReplValue = { ok: true; value: string };
type ReplError = { ok: false; error: string };
type ReplResult = ReplValue | ReplError;

const stdout = process.stdout
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(new TextLineStream());
const lineReader = stdout.getReader();

async function execute(code: string): Promise<ReplResult> {
  const trimmedCode = code.trim();
  if (trimmedCode.includes("\n")) {
    throw new Error("Multi-line code is not supported");
  }

  await writer.ready;
  await writer.write(`${trimmedCode}\n\n`);

  let result: ReplResult | null = null;

  while (true) {
    const { value: line, done } = await lineReader.read();
    if (done) throw new Error("Stream ended unexpectedly");

    console.log("OUTPUT", line);

    // Skip echo of the command and empty newline
    if (!result && line.startsWith(">> ")) {
      continue;
    }

    // Skip console.log output and other non-result lines before we have a result
    if (!result && !line.startsWith("=> ") && !line.startsWith("!! ")) {
      continue;
    }

    // Parse result line
    if (line.startsWith("=> ")) {
      if (!result) {
        // This is our result
        result = { ok: true, value: line.slice(3) };
        continue;
      } else {
        // This is the result of the empty command we sent, skip it
        continue;
      }
    }

    if (line.startsWith("!! ")) {
      if (!result) {
        result = { ok: false, error: line.slice(3) };
        continue;
      } else {
        // Result of empty command, skip
        continue;
      }
    }

    // Prompt for the empty command means we're done
    if (line.startsWith(">> ") && result) {
      return result;
    }

    // Multi-line continuation
    if (result) {
      if (result.ok) result.value += `\n${line}`;
      else result.error += `\n${line}`;
    }
  }
}

// Experiment
const result1 = await execute("1");
assertEquals(result1, { ok: true, value: "1" });

const result2 = await execute("console.log('hi')");
assertEquals(result2, { ok: true, value: "undefined" });

const result3 = await execute("Error");
console.log(result3);
