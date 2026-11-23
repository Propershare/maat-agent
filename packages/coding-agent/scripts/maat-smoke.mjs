import { Sandbox, detectSandboxCapabilities } from "@earendil-works/pi-coding-agent";
const caps = detectSandboxCapabilities();
if (caps.backend !== "bubblewrap") throw new Error("no bubblewrap backend: " + JSON.stringify(caps));
const sandbox = await Sandbox.provision();
const result = await sandbox.run(["/bin/sh", "-c", "printf 'maat-install-ok' > output.txt && cat output.txt"]);
console.log(JSON.stringify({ caps, exitCode: result.exitCode, stdout: result.stdout.trim() }));
await sandbox.close();
