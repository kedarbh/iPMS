'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { NotificationPage, UnreadCount } from '@ipms/contracts';
import {
  markEveryRead, markIdsUnread, markOneRead, toItem,
  type Category, type NotificationItem,
} from './notification-model';

/** How often the badge re-checks while the tab is visible. */
const POLL_MS = 30_000;
const NO_STORE: RequestInit = { cache: 'no-store' };

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * `keepalive` lets the request outlive the page: clicking a notification marks it
 * read and navigates away in the same gesture, and without it the browser may
 * cancel the request as the page unloads.
 */
async function post(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { method: 'POST', keepalive: true })).ok;
  } catch {
    return false;
  }
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | Category>('all');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [count, setCount] = useState(0);
  const [load, setLoad] = useState<LoadState>('idle');
  const [failure, setFailure] = useState<string | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/unread-count', NO_STORE);
      if (!response.ok) return;
      setCount(((await response.json()) as UnreadCount).count);
    } catch {
      // The badge keeps its last value; the next poll tries again.
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoad('loading');
    try {
      const response = await fetch('/api/notifications?limit=20', NO_STORE);
      if (!response.ok) throw new Error(String(response.status));
      const page = (await response.json()) as NotificationPage;
      const now = new Date();
      setItems(page.items.map((dto) => toItem(dto, now)));
      setLoad('ready');
    } catch {
      setLoad('error');
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshCount();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    setFailure(null);
    void loadList();
    void refreshCount();
  }, [open, loadList, refreshCount]);

  /**
   * Optimistic: update at once, and on refusal undo only this change (never restore a
   * captured snapshot, which could clobber fresher state), then re-sync the badge.
   */
  async function markAsRead(id: string) {
    if (!items.find((item) => item.id === id)?.unread) return;
    setItems((prev) => markOneRead(prev, id));
    setCount((c) => Math.max(0, c - 1));
    if (!(await post(`/api/notifications/${encodeURIComponent(id)}/read`))) {
      setItems((prev) => markIdsUnread(prev, new Set([id])));
      setCount((c) => c + 1);
      setFailure('Could not mark that notification as read.');
    }
    // The panel lists the newest 20; the server's count is the source of truth.
    void refreshCount();
  }

  async function markAllAsRead() {
    const unreadIds = new Set(items.filter((item) => item.unread).map((item) => item.id));
    setItems((prev) => markEveryRead(prev));
    setCount(0);
    if (!(await post('/api/notifications/read-all'))) {
      setItems((prev) => markIdsUnread(prev, unreadIds));
      setFailure('Could not mark notifications as read.');
    }
    // Restores the badge after a failure and covers unread items beyond the listed 20.
    void refreshCount();
  }

  const filtered = items.filter((item) => filter === 'all' || item.category === filter);

  return (
    <div className="notif-wrapper">
      <button
        type="button"
        className={`notif-bell-btn${open ? ' active' : ''}`}
        onClick={() => setOpen(!open)}
        aria-label={`Notifications, ${count} unread`}
        title="Notifications"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>

        {count > 0 ? (
          <span className="notif-badge" aria-hidden="true">
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div
            className="notif-backdrop"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="notif-dropdown" role="dialog" aria-label="Notifications panel">
            <div className="notif-header">
              <div className="notif-header-title">
                <h3>Notifications</h3>
                {count > 0 ? (
                  <span className="notif-count-pill">{count} new</span>
                ) : null}
              </div>
              {count > 0 ? (
                <button
                  type="button"
                  className="notif-mark-read-btn"
                  onClick={() => void markAllAsRead()}
                >
                  Mark all as read
                </button>
              ) : null}
            </div>

            <div className="notif-tabs" role="tablist">
              <button
                type="button"
                className={`notif-tab${filter === 'all' ? ' active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`notif-tab${filter === 'qc' ? ' active' : ''}`}
                onClick={() => setFilter('qc')}
              >
                Quality & QC
              </button>
              <button
                type="button"
                className={`notif-tab${filter === 'work-order' ? ' active' : ''}`}
                onClick={() => setFilter('work-order')}
              >
                Work Orders
              </button>
              <button
                type="button"
                className={`notif-tab${filter === 'finance' ? ' active' : ''}`}
                onClick={() => setFilter('finance')}
              >
                Finance
              </button>
            </div>

            {failure ? (
              <div className="notif-empty" role="alert">
                <span>{failure}</span>
              </div>
            ) : null}

            <div className="notif-list">
              {load === 'loading' && items.length === 0 ? (
                <div className="notif-empty" role="status">
                  <span>Loading notifications…</span>
                </div>
              ) : load === 'error' ? (
                <div className="notif-empty" role="alert">
                  <p>Could not load notifications.</p>
                  <button type="button" className="notif-mark-read-btn" onClick={() => void loadList()}>
                    Try again
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="notif-empty">
                  <div className="notif-empty-icon" aria-hidden="true">✓</div>
                  <p>All caught up!</p>
                  <span>No notifications in this category.</span>
                </div>
              ) : (
                filtered.map((item) => (
                  <a
                    key={item.id}
                    href={item.href ?? '#'}
                    className={`notif-item${item.unread ? ' unread' : ''}`}
                    onClick={() => {
                      void markAsRead(item.id);
                      setOpen(false);
                    }}
                  >
                    <div className="notif-item-left">
                      <span className={`notif-dot ${item.category}`} aria-hidden="true" />
                    </div>
                    <div className="notif-item-content">
                      <div className="notif-item-row">
                        <span className="notif-item-title">{item.title}</span>
                        <span className="notif-item-time">{item.time}</span>
                      </div>
                      <p className="notif-item-desc">{item.description}</p>
                    </div>
                  </a>
                ))
              )}
            </div>

            <div className="notif-footer">
              <a href="/quality/work-orders" onClick={() => setOpen(false)}>
                View all work orders &rarr;
              </a>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
