#!/usr/bin/env node
import { type MaatCliIo, runMaatCli } from "./commands.js";

const io: MaatCliIo = {
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
};
process.exitCode = await runMaatCli(process.argv.slice(2), {}, io);
