export function request(url: string): Promise<any> {
  return fetch(url);
}
