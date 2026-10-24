import type { ComponentType } from 'react';

/** Свойства, которые получает интерфейс любой игры. */
export interface GameUIProps<View = unknown, Action = unknown> {
  view: View;
  /** Моё место за столом. */
  seat: number;
  /** Допустимые действия (приходят с сервера, пока мой ход). */
  legal: Action[];
  myTurn: boolean;
  /** Отправить действие. Для оффлайн-режимов подменяется локальным исполнителем. */
  onAction: (action: Action) => void;
  disabled: boolean;
}

/**
 * Реестр интерфейсов игр. Новая игра = компонент здесь + движок в game-engine.
 * Пока для игры нет собственного интерфейса, используется универсальный (GenericBoard).
 */
export const GAME_UIS: Record<string, ComponentType<GameUIProps<any, any>>> = {};
