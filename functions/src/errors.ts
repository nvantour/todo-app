export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export const notFound = (what = 'Niet gevonden') => new HttpError(404, 'not_found', what)
export const badRequest = (message: string, code = 'bad_request') => new HttpError(400, code, message)
