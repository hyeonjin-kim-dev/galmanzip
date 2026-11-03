import SearchSelect from './SearchSelect'

const formatTime = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return hours ? `${hours}시간${remainder ? ` ${remainder}분` : ''}` : `${minutes}분`
}
const options = Array.from({ length: 18 }, (_, index) => {
  const value = (index + 1) * 10
  return { value, label: index === 0 ? '0~10분' : `${formatTime(value - 10)} ~ ${formatTime(value)}` }
})

export default function TravelTimeSelect(props: { label: string; value: number | null; onChange(value: number): void }) {
  return <SearchSelect {...props} options={options} className="travel-time-field" />
}
