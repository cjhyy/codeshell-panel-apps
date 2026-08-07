# Job intelligence source quality

## Source order

1. Employer careers page or official company site
2. Original public ATS or recruiting publisher page
3. Reputable public reporting or professional profile
4. Public employee or candidate review with visible context
5. Search snippet, aggregator copy, or anonymous discussion

Lower-ranked sources can discover a lead but should not silently override a
more direct source.

## Formal JD gate

Every candidate needs company, title, source, access time, and honest JD
completeness. A formal job additionally requires the complete visible source
text with substantive responsibilities and candidate requirements. The Panel
applies a minimum-text and section-signal gate; setting `full` alone does not
override missing content. Save canonical or visible URL, location,
compensation, published date, and work mode when visible. A recruiter-forwarded
or file-based full JD may lack a public URL, but its original project path must
remain traceable. Missing fields remain missing.

Search snippets, listing cards, marketing descriptions, and truncated detail
pages are `jobLeads`. They can guide the next detail-page visit but never count
as formal jobs or receive downstream preparation.

## Freshness and conflicts

- Prefer currently accessible listings with a visible recent date.
- Record both publication date and fetch time when available.
- A disappeared or contradicted listing is stale or unverified, not current.
- Preserve conflicting values and explain which source is more direct.

## Interpretation boundaries

- Official statements are company claims, not proof of employee experience.
- Reviews are subjective samples. Paraphrase and retain publisher/date/URL.
- Reported interview questions need an actual source.
- Predicted questions must be labeled as inference from the JD or candidate
  evidence.
- An incomplete listing is still useful when labeled `listing_only` or
  `partial`; it belongs in `jobLeads`, must not be presented as a complete JD,
  and must not count toward a requested job total.
