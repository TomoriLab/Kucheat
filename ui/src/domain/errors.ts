export type ErrorCode = "invalidChannelInput" | "invalidChannelHost" | "missingChannelId"
  | "duplicateChannel" | "longChannelName" | "invalidInterval" | "conflictingSecret"
  | "invalidLanguage" | "invalidDashboard" | "bridgeUnavailable" | "unknownError"
  | "invalidStreamerQuery" | "invalidSearchOffset" | "invalidSearchResults";

export class CodedError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(code);
    this.name = "CodedError";
    this.code = code;
  }
}
