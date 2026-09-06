/** UTF-16 offsets, matching DOM Range and Intl.Segmenter, across text nodes. */
export const indexText = (strings) => {
    let length = 0;
    const starts = strings.map(text => {
        const start = length;
        length += text.length;
        return start;
    });
    const position = (offset, end) => {
        let low = 0, high = starts.length - 1;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (end ? starts[mid] < offset : starts[mid] <= offset)
                low = mid;
            else
                high = mid - 1;
        }
        return [low, offset - starts[low]];
    };
    return {
        text: strings.join(''),
        range(start, end) {
            if (!strings.length || !Number.isInteger(start) || !Number.isInteger(end)
                || start < 0 || end < start || end > length)
                throw new RangeError('Text offsets are outside the indexed content');
            const [startIndex, startOffset] = position(start, false);
            const [endIndex, endOffset] = end === start
                ? [startIndex, startOffset] : position(end, true);
            return { startIndex, startOffset, endIndex, endOffset };
        },
    };
};
