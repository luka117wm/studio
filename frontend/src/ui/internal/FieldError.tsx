/** Подпись ошибки под полем: 11px в парном цвете failed. */
export function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} className="mt-1 text-11 text-failed-text">
      {message}
    </p>
  )
}
