import { BLOCK_CONFIG } from "../config/notion-config.js";
export class NotionBlockParser {
    /**
     * Notionブロックの配列をIR（中間表現）に変換
     */
    parseBlocks(blocks) {
        const nodes = [];
        let i = 0;
        while (i < blocks.length) {
            const block = blocks[i];
            const node = this.parseBlock(block);
            // リスト項目はグルーピング
            if (node.type === "bulletList" || node.type === "numberedList" || node.type === "todoList") {
                const grouped = this.groupListItems(blocks, i, node.type);
                nodes.push(grouped.node);
                i += grouped.consumed;
            }
            else {
                nodes.push(node);
                i++;
            }
        }
        return nodes;
    }
    /**
     * 個別のブロックをIRノードに変換
     */
    parseBlock(block) {
        switch (block.type) {
            case "paragraph":
                return this.parseParagraph(block);
            case "heading_1":
                return this.parseHeading(block, 1);
            case "heading_2":
                return this.parseHeading(block, 2);
            case "heading_3":
                return this.parseHeading(block, 3);
            case "bulleted_list_item":
                return this.parseListItem(block, "bulletList");
            case "numbered_list_item":
                return this.parseListItem(block, "numberedList");
            case "to_do":
                return this.parseTodoItem(block);
            case "code":
                return this.parseCode(block);
            case "quote":
                return this.parseQuote(block);
            case "callout":
                return this.parseCallout(block);
            case "divider":
                return { type: "divider" };
            case "image":
                return this.parseImage(block);
            case "table":
                return this.parseTable(block);
            case "table_row":
                return this.parseTableRow(block);
            case "bookmark":
                return this.parseBookmark(block);
            case "embed":
                return this.parseEmbed(block);
            case "toggle":
                // toggleは引用として扱う
                return this.parseQuote(block);
            case "child_page":
                // 子ページはスキップ
                if (BLOCK_CONFIG.UNSUPPORTED_BLOCK_WARNING) {
                    console.warn(`Skipping unsupported block: ${block.type} (child_page)`);
                }
                return { type: "unsupported", content: "[Child Page]" };
            case "child_database":
                // 子データベースはスキップ
                if (BLOCK_CONFIG.UNSUPPORTED_BLOCK_WARNING) {
                    console.warn(`Skipping unsupported block: ${block.type} (child_database)`);
                }
                return { type: "unsupported", content: "[Database]" };
            default:
                // 未対応ブロック
                if (BLOCK_CONFIG.UNSUPPORTED_BLOCK_WARNING) {
                    console.warn(`Unsupported block type: ${block.type}`);
                }
                return { type: "unsupported", content: `[Unsupported: ${block.type}]` };
        }
    }
    /**
     * 段落を解析
     */
    parseParagraph(block) {
        const richText = this.parseRichText(block.paragraph?.rich_text || []);
        return {
            type: "paragraph",
            richText,
        };
    }
    /**
     * 見出しを解析
     */
    parseHeading(block, level) {
        const richText = this.parseRichText(block[`heading_${level}`]?.rich_text || []);
        return {
            type: "heading",
            attributes: { level },
            richText,
        };
    }
    /**
     * リスト項目を解析
     */
    parseListItem(block, listType) {
        const richText = this.parseRichText(block[block.type]?.rich_text || []);
        return {
            type: listType,
            richText,
        };
    }
    /**
     * TODO項目を解析
     */
    parseTodoItem(block) {
        const richText = this.parseRichText(block.to_do?.rich_text || []);
        return {
            type: "todoList",
            attributes: { checked: block.to_do?.checked || false },
            richText,
        };
    }
    /**
     * コードブロックを解析
     */
    parseCode(block) {
        const content = block.code?.rich_text?.[0]?.plain_text || "";
        return {
            type: "code",
            content,
            attributes: { language: block.code?.language || "" },
        };
    }
    /**
     * 引用を解析
     */
    parseQuote(block) {
        const richText = this.parseRichText(block.quote?.rich_text || []);
        return {
            type: "quote",
            richText,
        };
    }
    /**
     * コールアウトを解析
     */
    parseCallout(block) {
        const richText = this.parseRichText(block.callout?.rich_text || []);
        const icon = block.callout?.icon;
        let iconText = "";
        if (icon?.type === "emoji") {
            iconText = icon.emoji;
        }
        else if (icon?.type === "external" && icon.external?.url) {
            iconText = "[Image]";
        }
        return {
            type: "callout",
            attributes: { icon: iconText },
            richText,
        };
    }
    /**
     * 画像を解析
     */
    parseImage(block) {
        const image = block.image;
        let url = "";
        let caption = "";
        if (image?.type === "file") {
            url = image.file?.url || "";
        }
        else if (image?.type === "external") {
            url = image.external?.url || "";
        }
        if (image?.caption) {
            caption = image.caption.map((t) => t.plain_text).join("");
        }
        return {
            type: "image",
            content: url,
            attributes: { caption },
        };
    }
    /**
     * テーブルを解析
     */
    parseTable(block) {
        return {
            type: "table",
            attributes: {
                hasColumnHeader: block.table?.has_column_header || false,
                hasRowHeader: block.table?.has_row_header || false,
            },
        };
    }
    /**
     * テーブル行を解析
     */
    parseTableRow(block) {
        const cells = block.table_row?.cells || [];
        const children = cells.map((cell) => ({
            type: "tableCell",
            richText: this.parseRichText(cell),
        }));
        return {
            type: "tableRow",
            children,
        };
    }
    /**
     * ブックマークを解析
     */
    parseBookmark(block) {
        const bookmark = block.bookmark;
        const url = bookmark?.url || "";
        const caption = bookmark?.caption?.map((t) => t.plain_text).join("") || "";
        return {
            type: "bookmark",
            content: url,
            attributes: { caption },
        };
    }
    /**
     * 埋め込みを解析
     */
    parseEmbed(block) {
        const embed = block.embed;
        const url = embed?.url || "";
        return {
            type: "embed",
            content: url,
        };
    }
    /**
     * リッチテキストを解析
     */
    parseRichText(richText) {
        if (!richText || !Array.isArray(richText)) {
            return [];
        }
        return richText.map((text) => ({
            text: text.plain_text || "",
            annotations: {
                bold: text.annotations?.bold || false,
                italic: text.annotations?.italic || false,
                strikethrough: text.annotations?.strikethrough || false,
                underline: text.annotations?.underline || false,
                code: text.annotations?.code || false,
            },
            href: text.href || undefined,
        }));
    }
    /**
     * 連続するリスト項目をグルーピング
     */
    groupListItems(blocks, startIndex, listType) {
        const items = [];
        let i = startIndex;
        let consumed = 0;
        while (i < blocks.length) {
            const block = blocks[i];
            // 同じタイプのリスト項目かチェック
            if ((listType === "bulletList" && block.type === "bulleted_list_item") ||
                (listType === "numberedList" && block.type === "numbered_list_item") ||
                (listType === "todoList" && block.type === "to_do")) {
                const item = this.parseBlock(block);
                items.push(item);
                i++;
                consumed++;
            }
            else {
                break;
            }
        }
        return {
            node: {
                type: listType,
                children: items,
            },
            consumed,
        };
    }
}
