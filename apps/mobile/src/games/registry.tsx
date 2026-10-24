import type { ComponentType } from 'react';
import { CheckersBoard } from './checkers/CheckersBoard';
import { ChessBoard } from './chess/ChessBoard';
import { DurakTable } from './durak/DurakTable';
import { MonopolyTable } from './monopoly/MonopolyTable';

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
  /** Чьими глазами смотреть на стол (место снизу). По умолчанию — `seat`. */
  orientation?: number;
}

/**
 * Реестр интерфейсов игр. Новая игра = компонент здесь + движок в game-engine.
 * Пока для игры нет собственного интерфейса, используется универсальный (GenericBoard).
 */
export const GAME_UIS: Record<string, ComponentType<GameUIProps<any, any>>> = {
  chess: ChessBoard,
  checkers: CheckersBoard,
  durak: DurakTable,
  monopoly: MonopolyTable,
};
