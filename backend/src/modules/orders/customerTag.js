// A customer tag names who, among several people at one table, an order is for. Stored as
// typed (whitespace collapsed, 60 chars), compared case-insensitively: "Anil " and "anil"
// are the same customer. Null means "no tag" - the table's shared group.
const cleanTag = (tag) => String(tag ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || null;
const customerKey = (tag) => (cleanTag(tag) ?? '').toLowerCase();

// The same rule in SQL, for grouping and filtering open orders. `col` is the column.
const customerKeySql = (col) => `ISNULL(LOWER(LTRIM(RTRIM(${col}))), '')`;

module.exports = { cleanTag, customerKey, customerKeySql };
