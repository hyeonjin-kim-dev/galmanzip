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
        <select
          className="travel-time-select"
          name="travelTime"
          aria-label="소요 시간"
          defaultValue=""
        >
          <option value="" disabled hidden>소요 시간</option>
          <option value="30">약 30분</option>
          <option value="60">약 1시간</option>
          <option value="90">약 1시간 30분</option>
          <option value="120">약 2시간</option>
          <option value="150">약 2시간 30분</option>
          <option value="180">약 3시간</option>
        </select>
      </div>
    </div>
  )
}
