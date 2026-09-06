import { NS, childGetter, parseClock, resolveURL } from './epub-dom.js';
export const parseSMIL = (doc, href) => {
    const { $, $$$ } = childGetter(doc, NS.SMIL);
    const entries = [];
    for (const par of $$$(doc, 'par')) {
        const text = $(par, 'text')?.getAttribute('src');
        const audio = $(par, 'audio'), src = audio?.getAttribute('src');
        if (!text || !src)
            continue;
        const begin = parseClock(audio?.getAttribute('clipBegin')) ?? 0;
        const end = parseClock(audio?.getAttribute('clipEnd'));
        if (end != null && end < begin) {
            console.warn('Ignoring EPUB media clip ending before its beginning');
            continue;
        }
        const resolved = resolveURL(src, href);
        const item = { text: resolveURL(text, href), begin, end };
        const previous = entries.at(-1);
        if (previous?.src === resolved)
            previous.items.push(item);
        else
            entries.push({ src: resolved, items: [item] });
    }
    return entries;
};
export class MediaOverlay extends EventTarget {
    book;
    loadXML;
    createAudio;
    #entries = [];
    #lastSMIL;
    #sectionIndex = -1;
    #audioIndex = -1;
    #itemIndex = -1;
    #audio;
    #volume = 1;
    #rate = 1;
    #state = 'stopped';
    #generation = 0;
    constructor(book, loadXML, createAudio = url => new Audio(url)) {
        super();
        this.book = book;
        this.loadXML = loadXML;
        this.createAudio = createAudio;
    }
    get #activeAudio() { return this.#entries[this.#audioIndex]; }
    get #activeItem() { return this.#activeAudio?.items[this.#itemIndex]; }
    #error(error) {
        console.error('EPUB media overlay failed', error);
        this.dispatchEvent(new CustomEvent('error', { detail: error }));
    }
    #highlight() {
        this.dispatchEvent(new CustomEvent('highlight', { detail: this.#activeItem }));
    }
    #unhighlight() {
        this.dispatchEvent(new CustomEvent('unhighlight', { detail: this.#activeItem }));
    }
    async #play(audioIndex, itemIndex) {
        const generation = ++this.#generation;
        this.#stopAudio();
        if (itemIndex >= (this.#entries[audioIndex]?.items.length ?? 0)) {
            audioIndex++;
            itemIndex = 0;
        }
        this.#audioIndex = audioIndex;
        this.#itemIndex = itemIndex;
        const entry = this.#activeAudio, item = this.#activeItem;
        if (!entry || !item)
            return this.start(this.#sectionIndex + 1);
        const blob = await this.book.loadBlob(entry.src);
        if (generation !== this.#generation)
            return;
        if (!blob)
            throw new Error(`Missing EPUB media audio: ${entry.src}`);
        const url = URL.createObjectURL(blob);
        const audio = this.createAudio(url);
        this.#audio = audio;
        audio.volume = this.#volume;
        audio.playbackRate = this.#rate;
        audio.addEventListener('timeupdate', () => {
            if (audio !== this.#audio || audio.paused)
                return;
            const time = audio.currentTime, active = this.#activeItem;
            if (active?.end != null && time > active.end) {
                this.#unhighlight();
                if (this.#itemIndex === entry.items.length - 1) {
                    void this.#play(this.#audioIndex + 1, 0).catch((error) => this.#error(error));
                    return;
                }
            }
            const previous = this.#itemIndex;
            while (entry.items[this.#itemIndex + 1]?.begin <= time)
                this.#itemIndex++;
            if (this.#itemIndex !== previous)
                this.#highlight();
        });
        audio.addEventListener('error', () => {
            if (audio === this.#audio)
                this.#error(new Error(`Failed to load ${entry.src}`));
        });
        audio.addEventListener('playing', () => { if (audio === this.#audio)
            this.#highlight(); });
        audio.addEventListener('ended', () => {
            if (audio !== this.#audio)
                return;
            void this.#play(audioIndex + 1, 0).catch((error) => this.#error(error));
        });
        audio.addEventListener('canplaythrough', () => {
            if (audio !== this.#audio)
                return;
            // WebKit requires the seek after media has become playable.
            audio.currentTime = item.begin;
            if (this.#state !== 'paused') {
                this.#state = 'playing';
                void audio.play().catch((error) => this.#error(error));
            }
        }, { once: true });
        if (this.#state === 'paused') {
            this.#highlight();
            audio.currentTime = item.begin;
        }
    }
    async #start(sectionIndex, filter, backwards = false) {
        const generation = ++this.#generation;
        this.#stopAudio();
        const step = backwards ? -1 : 1;
        for (let index = sectionIndex; index >= 0 && index < this.book.sections.length; index += step) {
            const section = this.book.sections[index], href = section.mediaOverlay?.href;
            if (!href)
                continue;
            if (href !== this.#lastSMIL) {
                const doc = await this.loadXML(href);
                if (generation !== this.#generation)
                    return;
                if (!doc)
                    throw new Error(`Missing EPUB media overlay: ${href}`);
                this.#entries = parseSMIL(doc, href);
                this.#lastSMIL = href;
            }
            this.#sectionIndex = index;
            const audioIndices = Array.from(this.#entries.keys());
            if (backwards)
                audioIndices.reverse();
            for (const i of audioIndices) {
                const { items } = this.#entries[i];
                const itemIndices = Array.from(items.keys());
                if (backwards)
                    itemIndices.reverse();
                for (const j of itemIndices)
                    if (items[j].text.split('#')[0] === section.id && filter(items[j], j, items))
                        return this.#play(i, j);
            }
        }
        this.#state = 'stopped';
    }
    start(sectionIndex, filter = () => true) {
        return this.#start(sectionIndex, filter).catch((error) => this.#error(error));
    }
    pause() { this.#state = 'paused'; this.#audio?.pause(); }
    resume() {
        this.#state = 'playing';
        void this.#audio?.play().catch((error) => this.#error(error));
    }
    #stopAudio() {
        const audio = this.#audio;
        if (!audio)
            return;
        this.#audio = undefined;
        audio.pause();
        URL.revokeObjectURL(audio.src);
        this.#unhighlight();
    }
    stop() { this.#generation++; this.#state = 'stopped'; this.#stopAudio(); }
    prev() {
        const previous = this.#entries[this.#audioIndex - 1];
        const result = this.#itemIndex > 0 ? this.#play(this.#audioIndex, this.#itemIndex - 1)
            : previous ? this.#play(this.#audioIndex - 1, previous.items.length - 1)
                : this.#start(this.#sectionIndex - 1, () => true, true);
        return result.catch((error) => this.#error(error));
    }
    next() { return this.#play(this.#audioIndex, this.#itemIndex + 1).catch((error) => this.#error(error)); }
    setVolume(volume) {
        this.#volume = volume;
        if (this.#audio)
            this.#audio.volume = volume;
    }
    setRate(rate) {
        this.#rate = rate;
        if (this.#audio)
            this.#audio.playbackRate = rate;
    }
}
