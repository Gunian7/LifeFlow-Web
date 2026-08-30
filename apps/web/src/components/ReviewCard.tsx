interface ReviewCardProps {
  items: Array<{ title: string; count: number }>
  onFinish: () => void
}

export function ReviewCard({ items, onFinish }: ReviewCardProps) {
  return (
    <section className="edit-card review-card" aria-label="每周回顾">
      <p className="label">WEEKLY / 每周回顾</p>
      <h2>这一周，你做过这些</h2>
      <p className="settings-copy">不算完成率，不排名次。做过，就算数。</p>
      <ul className="review-list">{items.map((item) => <li key={item.title}>{item.title}{item.count > 1 ? ` ×${item.count}` : ''}</li>)}</ul>
      <button className="secondary-button" type="button" onClick={onFinish}>好</button>
    </section>
  )
}
