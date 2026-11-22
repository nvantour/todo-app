/** Sessie van dit account is verlopen of ingetrokken; opnieuw inloggen kan alleen vanuit een klik. */
export class LoginNeeded extends Error {
  constructor(public email: string) { super(`De sessie van ${email} is verlopen.`); }
}
