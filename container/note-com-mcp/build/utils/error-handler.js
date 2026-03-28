export function createSuccessResponse(data) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(data, null, 2),
            },
        ],
    };
}
export function createErrorResponse(error) {
    const errorMessage = error instanceof Error ? error.message : error;
    return {
        content: [
            {
                type: "text",
                text: errorMessage,
            },
        ],
        isError: true,
    };
}
export function createAuthErrorResponse() {
    return createErrorResponse("認証情報がないため、この操作を実行できません。.envファイルに認証情報を設定してください。");
}
export function createNotFoundResponse(resource) {
    return createErrorResponse(`${resource}が見つかりませんでした。`);
}
export function createValidationErrorResponse(field, reason) {
    return createErrorResponse(`入力検証エラー: ${field} - ${reason}`);
}
// 共通のエラーハンドラー
export function handleApiError(error, operation) {
    console.error(`Error in ${operation}:`, error);
    if (error.message?.includes("認証")) {
        return createAuthErrorResponse();
    }
    if (error.message?.includes("404")) {
        return createNotFoundResponse(operation);
    }
    return createErrorResponse(`${operation}に失敗しました: ${error.message || error}`);
}
// レスポンスデータの安全な抽出
export function safeExtractData(apiResponse, extractors, defaultValue = []) {
    if (!apiResponse?.data) {
        return defaultValue;
    }
    for (const extractor of extractors) {
        const result = extractor(apiResponse.data);
        if (result !== null && Array.isArray(result)) {
            return result;
        }
    }
    return defaultValue;
}
// 一般的なデータ抽出器
export const commonExtractors = {
    notes: [
        (data) => (Array.isArray(data.notes) ? data.notes : null),
        (data) => (data.notes?.contents ? data.notes.contents : null),
        (data) => Array.isArray(data.contents)
            ? data.contents
                .filter((item) => item.type === "note")
                .map((item) => item.note || item)
            : null,
        (data) => (Array.isArray(data) ? data : null),
    ],
    users: [
        (data) => (Array.isArray(data.users) ? data.users : null),
        (data) => (Array.isArray(data) ? data : null),
    ],
    magazines: [
        (data) => (Array.isArray(data.magazines) ? data.magazines : null),
        (data) => (Array.isArray(data) ? data : null),
    ],
    memberships: [
        (data) => (Array.isArray(data.summaries) ? data.summaries : null),
        (data) => (Array.isArray(data.membership_summaries) ? data.membership_summaries : null),
        (data) => (Array.isArray(data.circles) ? data.circles : null),
        (data) => (Array.isArray(data.memberships) ? data.memberships : null),
        (data) => (Array.isArray(data) ? data : null),
    ],
    plans: [
        (data) => (Array.isArray(data.plans) ? data.plans : null),
        (data) => (Array.isArray(data.circle_plans) ? data.circle_plans : null),
        (data) => (Array.isArray(data) ? data : null),
    ],
};
// トータル件数の安全な抽出
export function safeExtractTotal(apiResponse, arrayLength) {
    if (!apiResponse?.data) {
        return arrayLength;
    }
    const data = apiResponse.data;
    // 様々な総数プロパティを確認
    const totalFields = [
        "total_count",
        "totalCount",
        "notesCount",
        "usersCount",
        "magazinesCount",
        "total",
    ];
    for (const field of totalFields) {
        if (typeof data[field] === "number") {
            return data[field];
        }
    }
    // notesオブジェクトの中のtotal_countも確認
    if (data.notes && typeof data.notes.total_count === "number") {
        return data.notes.total_count;
    }
    return arrayLength;
}
