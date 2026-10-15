/**
 * Maps `items` through an async `fn`, running items that share a key one after
 * another and items with different keys in parallel. Results come back in the
 * original item order.
 *
 * Use this when several entries can point at the same document (e.g. two tokens
 * of one linked actor): each update then sees the previous one's result instead
 * of racing it.
 *
 * @template T, R
 * @param {T[]} items
 * @param {(item: T) => string} keyFn - Items with the same key run sequentially.
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapSerialPerKey(items, keyFn, fn) {
	const results = new Array(items.length);
	const groups = new Map();
	items.forEach((item, index) => {
		const key = keyFn(item);
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(index);
	});

	await Promise.all(
		[...groups.values()].map(async (indices) => {
			for (const index of indices) results[index] = await fn(items[index]);
		}),
	);

	return results;
}
