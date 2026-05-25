export class UserError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "UserError";
    this.exitCode = exitCode;
  }
}

export function fail(message: string, exitCode = 1): never {
  throw new UserError(message, exitCode);
}
