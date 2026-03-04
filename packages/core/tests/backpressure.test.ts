import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageQueue, BackpressureStrategy, createUME, TransportClass } from '../src/index.js';

function makeUME(id?: string) {
    return createUME({
        source: { protocol: 'test', adapter: 'test', address: '/' },
        body: { id: id ?? 'msg' },
    });
}

describe('MessageQueue', () => {
    it('enqueues and dequeues messages in order', () => {
        const q = new MessageQueue({ maxSize: 10, strategy: BackpressureStrategy.DROP_OLDEST });
        const a = makeUME('a');
        const b = makeUME('b');
        q.enqueue(a);
        q.enqueue(b);
        assert.equal(q.size, 2);
        assert.deepEqual((q.dequeue()!.body as any).id, 'a');
        assert.deepEqual((q.dequeue()!.body as any).id, 'b');
    });

    it('DROP_OLDEST removes oldest when full', () => {
        const q = new MessageQueue({ maxSize: 2, strategy: BackpressureStrategy.DROP_OLDEST });
        q.enqueue(makeUME('1'));
        q.enqueue(makeUME('2'));
        q.enqueue(makeUME('3')); // Should drop '1'
        assert.equal(q.size, 2);
        assert.equal((q.dequeue()!.body as any).id, '2');
        assert.equal((q.dequeue()!.body as any).id, '3');
    });

    it('DROP_NEWEST rejects new messages when full', () => {
        const q = new MessageQueue({ maxSize: 2, strategy: BackpressureStrategy.DROP_NEWEST });
        q.enqueue(makeUME('1'));
        q.enqueue(makeUME('2'));
        const accepted = q.enqueue(makeUME('3'));
        assert.equal(accepted, false);
        assert.equal(q.size, 2);
        assert.equal((q.dequeue()!.body as any).id, '1');
    });

    it('BLOCK pauses the queue when full', () => {
        const q = new MessageQueue({ maxSize: 2, strategy: BackpressureStrategy.BLOCK });
        q.enqueue(makeUME('1'));
        q.enqueue(makeUME('2'));
        q.enqueue(makeUME('3'));
        assert.ok(q.isPaused);
        assert.equal(q.size, 2); // Blocked, not enqueued
    });

    it('resume unpauses the queue', () => {
        const q = new MessageQueue({ maxSize: 1, strategy: BackpressureStrategy.BLOCK });
        q.enqueue(makeUME('1'));
        q.enqueue(makeUME('2'));
        assert.ok(q.isPaused);
        q.resume();
        assert.ok(!q.isPaused);
    });

    it('fires backpressure event handler', () => {
        const q = new MessageQueue({ maxSize: 2, strategy: BackpressureStrategy.DROP_OLDEST });
        let fired = false;
        q.onBackpressure(() => { fired = true; });
        q.enqueue(makeUME('1'));
        q.enqueue(makeUME('2'));
        q.enqueue(makeUME('3')); // triggers
        assert.ok(fired);
    });

    it('tracks totalEnqueued and totalDropped', () => {
        const q = new MessageQueue({ maxSize: 2, strategy: BackpressureStrategy.DROP_NEWEST });
        q.enqueue(makeUME('1'));
        q.enqueue(makeUME('2'));
        q.enqueue(makeUME('3')); // dropped
        q.enqueue(makeUME('4')); // dropped
        assert.equal(q.totalEnqueued, 4);
        assert.equal(q.totalDropped, 2);
    });

    it('clear empties the queue', () => {
        const q = new MessageQueue({ maxSize: 10, strategy: BackpressureStrategy.DROP_OLDEST });
        q.enqueue(makeUME('1'));
        q.enqueue(makeUME('2'));
        q.clear();
        assert.equal(q.size, 0);
        assert.ok(!q.isPaused);
    });
});
