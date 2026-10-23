// 수집을 지금 시작할지 정한다. 결과는 GITHUB_OUTPUT의 run=true|false 와 로그 한 줄.
//
// GitHub 예약 실행은 몇 시간씩 늦거나 빠지기도 해서, 업무 시간에는 15분마다 이 판정만 가볍게 돌린다.
// - 예약 실행: 오늘 지난 수집 시각(SLOTS_KST) 중 가장 최근 것 이후로 수집한 적이 없으면 시작한다.
// - 수동 실행: force면 항상, 아니면 마지막 수집 후 MIN_INTERVAL_MINUTES가 지났을 때 시작한다.

import fs from 'node:fs';

const KST_OFFSET_MS = 9 * 3600 * 1000;

export function decide({ event, force, now, lastGeneratedAt, slotsKst, minIntervalMinutes }) {
    if (force) return { run: true, reason: '강제 실행' };

    const ageMinutes = Number.isFinite(lastGeneratedAt) ? (now - lastGeneratedAt) / 60000 : Infinity;

    if (event !== 'schedule') {
        const run = ageMinutes >= minIntervalMinutes;
        return { run, reason: `마지막 수집 ${Math.round(ageMinutes)}분 전${run ? '' : ` (${minIntervalMinutes}분 이내라 건너뜀)`}` };
    }

    const kst = new Date(now + KST_OFFSET_MS);
    const hour = kst.getUTCHours();
    const passed = slotsKst.filter((slot) => slot <= hour);
    if (passed.length === 0) return { run: false, reason: `첫 수집 시각(${slotsKst[0]}시) 전` };

    const slot = Math.max(...passed);
    const slotAt = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), slot) - KST_OFFSET_MS;
    const run = !(lastGeneratedAt >= slotAt);
    return { run, reason: `${slot}시 수집 ${run ? '아직 안 함' : '이미 완료'}` };
}

// 직접 실행할 때만 판정한다(테스트에서 decide만 가져다 쓸 수 있게).
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/should-fetch.mjs')) {
    let lastGeneratedAt = NaN;
    try {
        lastGeneratedAt = Date.parse(JSON.parse(fs.readFileSync('data/bids.json', 'utf8')).generatedAt);
    } catch {
        // 데이터가 없으면 수집한다.
    }
    const result = decide({
        event: process.env.EVENT || 'schedule',
        force: process.env.FORCE === 'true',
        now: process.env.NOW ? Date.parse(process.env.NOW) : Date.now(),
        lastGeneratedAt,
        slotsKst: String(process.env.SLOTS_KST || '7,9,11,13,15,17').split(',').map(Number).sort((a, b) => a - b),
        minIntervalMinutes: Number(process.env.MIN_INTERVAL_MINUTES || 90)
    });
    console.log(`${result.run ? '수집 시작' : '건너뜀'}: ${result.reason}`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `run=${result.run}\n`);
}
