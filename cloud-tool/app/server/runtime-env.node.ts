export function getRuntimeValue(name: string): string | undefined {
  return process.env[name];
}

export function runtimePlatform(): "node" {
  return "node";
}
