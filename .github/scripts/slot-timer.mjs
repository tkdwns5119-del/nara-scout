// 다음 수집 시각까지 얼마나 기다릴지 정한다. 결과는 GITHUB_OUTPUT의 wait_seconds, fire.
//
// GitHub 예약 실행은 몇 시간씩 늦거나 빠져서, 실행 하나가 다음 수집 시각까지 기다렸다가 수집을 시작하고
// 다음 타이머를 띄우는 방식으로 이어 간다. 실행 하나는 최대 6시간이라 한 번에 MAX_WAIT_MINUTES까지만 기다린다.
// - 다음 수집 시각이 기다릴 수 있는 범위 안이면: 그때까지 기다린 뒤 수집(fire=true)
// - 너무 멀면(밤사이): MAX_WAIT_MINUTES만 기다리고 수집 없이 다음 타이머로 넘김(fire=false)
// - 방금 지난 수집 시각(CATCH_UP_MINUTES 이내)을 아직 수집하지 않았으면: 바로 수집

import fs from 'node:fs';

const KST_OFFSET_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export function planNext({ now, lastGeneratedAt, slotsKst, maxWaitMinutes, catchUpMinutes }) {
    const kst = new Date(now + KST_OFFSET_MS);
    const kstMidnight = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS;
    const slotTimes = [-1, 0, 1]
        .flatMap((day) => slotsKst.map((hour) => kstMidnight + day * DAY_MS + hour * 3600 * 1000))
        .sort((a, b) => a - b);

    const lastSlot = slotTimes.filter((at) => at <= now).at(-1);
    if (lastSlot !== undefined && now - lastSlot <= catchUpMinutes * 60000 && !(lastGeneratedAt >= lastSlot)) {
        return { waitSeconds: 0, fire: true, slotAt: lastSlot, reason: '방금 지난 수집 시각을 아직 수집하지 않음' };
    }

    const nextSlot = slotTimes.find((at) => at > now);
    const waitMs = nextSlot - now;
    if (waitMs <= maxWaitMinutes * 60000) {
        return { waitSeconds: Math.ceil(waitMs / 1000), fire: true, slotAt: nextSlot, reason: '다음 수집 시각까지 대기' };
    }
    return { waitSeconds: maxWaitMinutes * 60, fire: false, slotAt: nextSlot, reason: `다음 수집 시각이 ${maxWaitMinutes}분보다 멀어 중간 타이머로 넘김` };
}

function kstLabel(at) {
    const d = new Date(at + KST_OFFSET_MS);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} KST`;
}

// 직접 실행할 때만 계산한다(테스트에서 planNext만 가져다 쓸 수 있게).
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/slot-timer.mjs')) {
    let lastGeneratedAt = NaN;
    try {
        lastGeneratedAt = Date.parse(JSON.parse(fs.readFileSync('data/bids.json', 'utf8')).generatedAt);
    } catch {
        // 데이터가 없으면 방금 지난 수집 시각부터 수집한다.
    }
    const plan = planNext({
        now: process.env.NOW ? Date.parse(process.env.NOW) : Date.now(),
        lastGeneratedAt,
        slotsKst: String(process.env.SLOTS_KST || '7,9,11,13,15,17').split(',').map(Number).sort((a, b) => a - b),
        maxWaitMinutes: Number(process.env.MAX_WAIT_MINUTES || 330),
        catchUpMinutes: Number(process.env.CATCH_UP_MINUTES || 110)
    });
    console.log(`${plan.reason}: ${kstLabel(plan.slotAt)} 수집, ${Math.round(plan.waitSeconds / 60)}분 대기, 수집 ${plan.fire ? '함' : '안 함'}`);
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `wait_seconds=${plan.waitSeconds}\nfire=${plan.fire}\n`);
    }
}
