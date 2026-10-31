export default function DestinationSearch() {
  return (
    <label className="destination-search">
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
  )
}
