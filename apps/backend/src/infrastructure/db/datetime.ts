export function toMysqlDateTime(input: string | Date): string {
  const date = input instanceof Date ? input : new Date(input);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`[db] Invalid datetime input: ${String(input)}`);
  }

  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  const millis = pad(date.getUTCMilliseconds(), 3);

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${millis}`;
}

function pad(value: number, size = 2): string {
  return value.toString().padStart(size, "0");
}
