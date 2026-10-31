import TravelTimeSelect from './TravelTimeSelect'

export default function DestinationSearch() {
  return (
    <div className="destination-search">
      <label>
        <span className="visually-hidden">목적지 검색</span>
        <input
          className="destination-input"
          type="search"
          name="destination"
          placeholder="목적지"
          autoComplete="off"
          enterKeyHint="search"
          spellCheck={false}
        />
      </label>
      <div className="search-options">
        <TravelTimeSelect />
      </div>
    </div>
  )
}
