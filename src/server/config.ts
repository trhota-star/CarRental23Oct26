export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required setting ${name} (see .env.example)`);
  return value;
}
