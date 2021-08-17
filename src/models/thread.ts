/*
Copyright 2021 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { EventEmitter } from "events";
import { MatrixClient } from "../matrix";
import { MatrixEvent } from "./event";

export class Thread extends EventEmitter {
    private root: string;
    public tail = new Set<string>();
    private events = new Map<string, MatrixEvent>();
    private decrypted = false;

    constructor(
        events: MatrixEvent[] = [],
        public readonly client: MatrixClient,
    ) {
        super();
        events.forEach(event => this.addEvent(event));
    }

    /**
     * Add an event to the thread and updates
     * the tail/root references if needed
     * @param event The event to add
     */
    public addEvent(event: MatrixEvent): void {
        if (this.events.has(event.getId())) {
            return;
        }

        if (this.tail.has(event.replyEventId)) {
            this.tail.delete(event.replyEventId);
        }
        this.tail.add(event.getId());

        if (!event.replyEventId || !this.events.has(event.replyEventId)) {
            this.root = event.getId();
        }

        this.events.set(event.getId(), event);
        event.setThread(this);

        if (this.ready) {
            this.client.decryptEventIfNeeded(event, {});
            this.emit("Thread.update", this);
        }
    }

    public async fetchReplyChain(): Promise<void> {
        if (!this.ready) {
            const mxEvent = await this.fetchEventById(
                this.rootEvent.getRoomId(),
                this.rootEvent.replyEventId,
            );
            this.addEvent(mxEvent);
            if (mxEvent.replyEventId) {
                await this.fetchReplyChain();
            } else {
                await this.decryptEvents();
                this.emit("Thread.ready", this);
            }
        }
    }

    private async decryptEvents(): Promise<void> {
        await Promise.allSettled(
            Array.from(this.events.values()).map(event => {
                return this.client.decryptEventIfNeeded(event, {});
            }),
        );

        this.decrypted = true;
    }

    public async fetchEventById(roomId: string, eventId: string): Promise<MatrixEvent> {
        const response = await this.client.http.authedRequest(
            undefined,
            "GET",
            `/rooms/${roomId}/event/${eventId}`,
        );
        return new MatrixEvent(response);
    }

    public get ready(): boolean {
        return this.rootEvent.replyEventId === undefined && this.decrypted;
    }

    /**
     * A sorted list of events to display
     */
    public get eventTimeline(): MatrixEvent[] {
        return Array.from(this.events.values())
            .sort((a, b) => a.getTs() - b.getTs());
    }

    /**
     * The thread ID, which is the same as the root event ID
     */
    public get id(): string {
        return this.root;
    }

    public get rootEvent(): MatrixEvent {
        return this.events.get(this.root);
    }

    /**
     * The number of messages in the thread
     */
    public get length(): number {
        return this.eventTimeline.length;
    }

    /**
     * A set of mxid participating to the thread
     */
    public get participants(): Set<string> {
        const participants = new Set<string>();
        this.events.forEach(event => {
            participants.add(event.getSender());
        });
        return participants;
    }
}
