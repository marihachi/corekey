export function generateEAID(time: number, randomLength: number, randFunc: () => number) {
	const timestamp = time.toString(36).padStart(9, '0');

	let random = '';
	for (let i = 0; i < randomLength; i++) {
		random += Math.floor(randFunc() * 36).toString(36);
	}

	return timestamp + random;
}
export function generateEAID12() {
	return generateEAID(Date.now(), 3, Math.random);
}
export function generateEAID16() {
	return generateEAID(Date.now(), 7, Math.random);
}
export function generateEAID24() {
	return generateEAID(Date.now(), 15, Math.random);
}
export function generateEAID32() {
	return generateEAID(Date.now(), 23, Math.random);
}
