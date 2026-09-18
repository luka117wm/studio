import { clsx, type ClassValue } from 'clsx'

/** Склейка классов: строки, массивы, объекты-условия; falsy отбрасываются. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
