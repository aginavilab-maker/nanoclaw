// Notion → note.com Integration のための型定義
// エラーコード列挙型
export var NotionErrorCode;
(function (NotionErrorCode) {
    NotionErrorCode["INVALID_TOKEN"] = "INVALID_TOKEN";
    NotionErrorCode["TOKEN_EXPIRED"] = "TOKEN_EXPIRED";
    NotionErrorCode["PAGE_NOT_FOUND"] = "PAGE_NOT_FOUND";
    NotionErrorCode["NO_ACCESS"] = "NO_ACCESS";
    NotionErrorCode["RATE_LIMITED"] = "RATE_LIMITED";
    NotionErrorCode["NETWORK_ERROR"] = "NETWORK_ERROR";
    NotionErrorCode["SERVER_ERROR"] = "SERVER_ERROR";
    NotionErrorCode["UNSUPPORTED_BLOCK"] = "UNSUPPORTED_BLOCK";
    NotionErrorCode["IMAGE_DOWNLOAD_FAILED"] = "IMAGE_DOWNLOAD_FAILED";
    NotionErrorCode["IMAGE_UPLOAD_FAILED"] = "IMAGE_UPLOAD_FAILED";
})(NotionErrorCode || (NotionErrorCode = {}));
