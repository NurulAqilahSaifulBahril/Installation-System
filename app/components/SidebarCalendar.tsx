"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { CalendarDayDetail } from "@/lib/types";
import WeatherGlyph from "@/app/components/WeatherGlyph";

interface SidebarCalendarProps {
  // Keyed by "YYYY-MM-DD"; a day with neither a customer nor a crew booked is
  // simply absent, which is also what marks a day as empty in the grid.
  dayDetails: Record<string, CalendarDayDetail>;
  // Also keyed by date. Open-Meteo only forecasts about 16 days out, so most
  // of the calendar has no entry and says so rather than reading 0%.
  weather: Record<string, { rainProbability: number; weatherCode: number }>;
  holidays: Record<string, string>;
  selectedDate: string;
  onSelectDate: (dateKey: string) => void;
}

// Where the hover card is pinned. Fixed to the viewport rather than positioned
// inside the calendar: the sidebar scrolls and clips its overflow, which would
// cut the card off at the panel edge.
type HoverAnchor = { key: string; top: number; left: number };

const CARD_ESTIMATED_HEIGHT = 260;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function SidebarCalendar({
  dayDetails,
  weather,
  holidays,
  selectedDate,
  onSelectDate,
}: SidebarCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [hover, setHover] = useState<HoverAnchor | null>(null);

  const daysInMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth() + 1,
    0,
  ).getDate();
  const firstDay = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth(),
    1,
  ).getDay();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const monthName = currentMonth.toLocaleDateString("en-MY", {
    month: "short",
    year: "numeric",
  });

  function changeMonth(offset: number) {
    // The anchor points at a cell that is about to be replaced, so a card left
    // open would describe a day no longer under the cursor.
    setHover(null);
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset),
    );
  }

  // Dates are stored as plain "YYYY-MM-DD" strings, so they are compared as
  // strings. Going through Date would parse them as UTC midnight and then read
  // back local components, which slips a day for anyone west of Greenwich.
  const keyFor = (day: number) =>
    `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const todayKey = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  })();

  // Opens for every day, not only booked ones: weather and the public holiday
  // are facts about the date itself, and they are most worth reading on the
  // empty days — those are the ones being considered for scheduling.
  function openCard(key: string, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    setHover({
      key,
      // Clamped so a day near the bottom of the sidebar opens its card fully
      // on screen instead of running past the fold.
      top: Math.max(
        8,
        Math.min(rect.top, window.innerHeight - CARD_ESTIMATED_HEIGHT),
      ),
      left: rect.right + 10,
    });
  }

  // A day with no bookings still has a card — it carries the weather and any
  // public holiday — so these fall back to empty rather than gating the card.
  const hoveredDetail = hover ? dayDetails[hover.key] : null;
  const teams = hoveredDetail?.teams ?? [];
  const customers = hoveredDetail?.customers ?? [];
  const dayWeather = hover ? weather[hover.key] : undefined;
  const dayHoliday = hover ? holidays[hover.key] : undefined;

  return (
    <div className="sidebar-calendar">
      <div className="sidebar-calendar-header">
        <button
          className="icon-button"
          aria-label="Previous month"
          onClick={() => changeMonth(-1)}
        >
          <ChevronLeft size={14} />
        </button>
        <strong>{monthName}</strong>
        <button
          className="icon-button"
          aria-label="Next month"
          onClick={() => changeMonth(1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="sidebar-calendar-grid">
        {WEEKDAYS.map((day) => (
          <div key={day} className="sidebar-calendar-weekday">
            {day}
          </div>
        ))}

        {Array.from({ length: firstDay }).map((_, i) => (
          <span key={`empty-${i}`} />
        ))}

        {days.map((day) => {
          const key = keyFor(day);
          const className = [
            "sidebar-calendar-day",
            dayDetails[key] ? "has-jobs" : "",
            // Marked on the grid itself, not just in the card — a holiday is
            // worth seeing before you decide which day to hover.
            holidays[key] ? "is-holiday" : "",
            key === todayKey ? "is-today" : "",
            key === selectedDate ? "is-selected" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={day}
              className={className}
              aria-pressed={key === selectedDate}
              // Every day is clickable, not just booked ones. Gating on booked
              // days made an empty day a dead click with no feedback, and
              // picking a free day to inspect is a normal thing to do.
              onClick={() => onSelectDate(key)}
              onMouseEnter={(event) => openCard(key, event.currentTarget)}
              onMouseLeave={() => setHover(null)}
              // Keyboard users get the same card: tabbing the grid is the only
              // way to reach it without a pointer.
              onFocus={(event) => openCard(key, event.currentTarget)}
              onBlur={() => setHover(null)}
            >
              {day}
            </button>
          );
        })}
      </div>

      {hover && (
        <div
          className="calendar-hover-card"
          role="tooltip"
          style={{ top: hover.top, left: hover.left }}
        >
          <div className="calendar-hover-head">
            <span className="calendar-hover-date">
              {new Date(`${hover.key}T00:00:00`)
                .toLocaleDateString("en-MY", {
                  weekday: "short",
                  day: "2-digit",
                  month: "short",
                })
                .toUpperCase()}
            </span>
            <span className="calendar-hover-count">
              {customers.length}
              <small>{customers.length === 1 ? "CUST" : "CUSTS"}</small>
            </span>
          </div>

          <div className="calendar-hover-section">
            <span className="calendar-hover-label">Conditions</span>
            <div className="calendar-hover-conditions">
              {dayWeather ? (
                <span
                  className={`calendar-hover-rain ${
                    dayWeather.rainProbability >= 70
                      ? "high-risk"
                      : dayWeather.rainProbability >= 40
                        ? "medium-risk"
                        : "low-risk"
                  }`}
                >
                  <WeatherGlyph code={dayWeather.weatherCode} size={13} />
                  {dayWeather.rainProbability}% rain
                </span>
              ) : (
                // Open-Meteo forecasts about 16 days out. Saying so beats an
                // empty row, which reads as a broken lookup rather than a
                // date that is simply too far away to forecast.
                <span className="calendar-hover-noforecast">
                  No forecast — about 2 weeks ahead only
                </span>
              )}
              {dayHoliday && (
                <span className="calendar-hover-holiday">{dayHoliday}</span>
              )}
            </div>
          </div>

          {teams.length > 0 && (
            <div className="calendar-hover-section">
              <span className="calendar-hover-label">Crew</span>
              {teams.map((team) => (
                <span className="calendar-hover-team" key={team}>
                  {team}
                </span>
              ))}
            </div>
          )}

          {customers.length > 0 && (
          <div className="calendar-hover-section">
            <span className="calendar-hover-label">Schedule</span>
            <div className="calendar-hover-rows">
              <div className="calendar-hover-row is-head">
                <span>Customer</span>
                <span>Stock</span>
                <span>Install</span>
              </div>
              {customers.map((customer) => (
                <div className="calendar-hover-row" key={customer.id}>
                  <span className="calendar-hover-name">{customer.name}</span>
                  {/* An em dash, not a blank: the column reads as "no time
                      recorded" rather than as a rendering gap. */}
                  <span className="calendar-hover-time">
                    {customer.stockDelivery || "—"}
                  </span>
                  <span className="calendar-hover-time">
                    {customer.installTime || "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
