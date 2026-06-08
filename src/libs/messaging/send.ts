import { AppError } from '@/shared/errors';
import type { Request, RequestOf, Response, ResponseData } from './protocol';

export async function sendMessage<T extends Request['type']>(
  request: RequestOf<T>,
): Promise<ResponseData<T>> {
  const response = (await chrome.runtime.sendMessage(request)) as Response<ResponseData<T>>;
  if (!response.ok) {
    throw new AppError(response.error, response.message);
  }
  return response.data;
}
