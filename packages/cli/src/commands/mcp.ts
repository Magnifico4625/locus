export async function runMcp(): Promise<number> {
  await import(new URL('./server.js', import.meta.url).href);
  return 0;
}
