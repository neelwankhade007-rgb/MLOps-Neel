/**
 * Utility to safely extract user-facing error messages while preventing
 * internal stack traces, filesystem paths, or sensitive backend error leakage.
 */
export const sanitizeErrorMessage = (
  error: unknown,
  fallback = 'An unexpected error occurred. Please try again.'
): string => {
  if (!error) return fallback;

  if (typeof error === 'string') {
    return cleanRawErrorString(error, fallback);
  }

  // Axios or HTTP error response
  if (typeof error === 'object' && error !== null) {
    const err = error as any;
    const detail = err.response?.data?.detail;

    if (detail) {
      if (typeof detail === 'string') {
        return cleanRawErrorString(detail, fallback);
      }
      if (Array.isArray(detail)) {
        // FastAPI / Pydantic validation error array
        const messages = detail
          .map((item) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object') {
              const field = Array.isArray(item.loc)
                ? item.loc.filter((l: any) => l !== 'body').join('.')
                : '';
              const msg = item.msg || 'Invalid value';
              return field ? `${field}: ${msg}` : msg;
            }
            return null;
          })
          .filter(Boolean);

        if (messages.length > 0) {
          return messages.join('; ');
        }
      }
      if (typeof detail === 'object') {
        const msg = detail.message || detail.error;
        if (typeof msg === 'string') return cleanRawErrorString(msg, fallback);
      }
    }

    const message = err.message;
    if (typeof message === 'string') {
      if (message.includes('Network Error') || err.code === 'ERR_NETWORK') {
        return 'Network connection error. Please check your connectivity or backend server.';
      }
      return cleanRawErrorString(message, fallback);
    }
  }

  return fallback;
};

const cleanRawErrorString = (msg: string, fallback: string): string => {
  const trimmed = msg.trim();
  if (!trimmed) return fallback;

  // Block leakage of python stack traces or internal filesystem paths
  if (
    trimmed.includes('Traceback (most recent call last)') ||
    trimmed.includes('File "') ||
    trimmed.includes('line ') && trimmed.includes('.py') ||
    trimmed.includes('sqlalchemy.exc') ||
    trimmed.includes('sqlite3.')
  ) {
    return 'A server processing error occurred. The operation could not be completed.';
  }

  return trimmed;
};

export default sanitizeErrorMessage;
