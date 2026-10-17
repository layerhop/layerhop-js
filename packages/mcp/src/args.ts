export function parseArgs(argv: string[]): { http: boolean; port: number; host: string; help: boolean; version: boolean } {
  const out = {
    http: false,
    port: Number(process.env.PORT) || 8090,
    host: process.env.HOST || "127.0.0.1",
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const [flag, inline] = a.includes("=") ? (a.split(/=(.*)/s, 2) as [string, string]) : [a, undefined];
    const value = () => inline ?? argv[++i];
    if (flag === "--http") out.http = true;
    else if (flag === "--port" || flag === "-p") out.port = Number(value());
    else if (flag === "--host") out.host = String(value());
    else if (flag === "--help" || flag === "-h") out.help = true;
    else if (flag === "--version" || flag === "-v") out.version = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) throw new Error(`Invalid port: ${out.port}`);
  return out;
}
